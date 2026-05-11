/**
 * Wire-format pin for `GasStationExecutor`. The Mysten sui-gas-pool
 * daemon is a black box for us at unit-test time, so we mock the two
 * HTTP calls and assert:
 *
 *   - reserve_gas: bearer auth, JSON body shape, gas budget passes through
 *   - execute_tx: base64 tx_bytes + user_sig, reservation id, options
 *     ask for {effects, events, objectChanges}
 *   - response translation: `tx_block_response` → `ExecutedTx` directly,
 *     no gRPC re-fetch (object id Created/Mutated mapping, owner shape,
 *     `objectTypes` map, event `eventType` rename)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Transaction } from "@mysten/sui/transactions";

const HOT_ADDR = `0x${"a".repeat(64)}`;
const SPONSOR_ADDR = `0x${"b".repeat(64)}`;
const DIGEST = "TX_DIGEST_FROM_POOL";

mock.module("@/config/env", () => ({
  env: {
    SUI_GAS_STATION_BUDGET_MIST: 500_000_000n,
    SUI_GAS_STATION_RESERVE_SECS: 30,
    HOT_WALLET_SUI_SECRET_HEX: "11".repeat(32),
    HOT_WALLET_PROVIDER: "env",
  },
}));

mock.module("@/config/log", () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

mock.module("@/shared/redis/lock", () => ({
  withLock: async (_key: string, fn: () => unknown) => fn(),
}));

// What the gas-pool returns inside execute_tx's tx_block_response.
const fakeTxBlock = {
  digest: DIGEST,
  effects: { status: { status: "success" } },
  events: [{ type: "0x1::test::Event", parsedJson: { hello: "world" } }],
  objectChanges: [
    {
      type: "created",
      objectId: "0xCREATED1",
      objectType: "0x1::test::Object",
      owner: { AddressOwner: HOT_ADDR },
    },
    {
      type: "mutated",
      objectId: "0xMUTATED1",
      objectType: "0x1::other::Object",
      owner: "Immutable",
    },
  ],
};

const buildMock = mock(async () => new Uint8Array([0xab, 0xcd, 0xef]));
const setSenderMock = mock((_a: string) => undefined);
const setGasOwnerMock = mock((_a: string) => undefined);
const setGasPaymentMock = mock((_c: unknown[]) => undefined);
const setGasBudgetMock = mock((_b: bigint) => undefined);

mock.module("@mysten/sui/transactions", () => ({
  Transaction: class {
    private sender: string | undefined;
    setSender(a: string) {
      this.sender = a;
      setSenderMock(a);
    }
    getData() {
      return { sender: this.sender };
    }
    setGasOwner(a: string) {
      setGasOwnerMock(a);
    }
    setGasPayment(c: unknown[]) {
      setGasPaymentMock(c);
    }
    setGasBudget(b: bigint) {
      setGasBudgetMock(b);
    }
    build() {
      return buildMock();
    }
  },
}));

mock.module("@/shared/sui/client", () => ({
  // build() never calls the sui client in the test path because we mock
  // the Transaction class. Provide an empty stub for any unexpected use.
  getSuiClient: () => ({ core: {} }),
}));

mock.module("@/shared/networks/registry", () => ({
  getNetwork: (_n: string) => ({
    gasStation: { url: "http://gas.local:9527", auth: "test-bearer" },
  }),
}));

const signTransactionMock = mock(async () => ({
  signature: "BASE64_USER_SIG",
}));
// Stub *only* signTransaction so the env-loaded hot wallet stays
// usable for sibling test files (mock.module persists across files in
// bun's loader). We patch the keypair's signTransaction by overriding
// the prototype, which is enough for this test's expectations and
// leaves the rest of the surface real.
mock.module("@mysten/sui/keypairs/ed25519", () => ({
  Ed25519Keypair: class FakeEd25519Keypair {
    static fromSecretKey(_seed: Uint8Array) {
      return new FakeEd25519Keypair();
    }
    getPublicKey() {
      return { toSuiAddress: () => HOT_ADDR };
    }
    signTransaction = signTransactionMock;
    signAndExecute = async () => ({ digest: DIGEST });
  },
}));

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls.length = 0;
  buildMock.mockClear();
  setSenderMock.mockClear();
  setGasOwnerMock.mockClear();
  setGasPaymentMock.mockClear();
  setGasBudgetMock.mockClear();
  signTransactionMock.mockClear();
});

// Imports come AFTER mock.module() calls so the mocks are in place
// when these modules first resolve (bun's module loader is process-
// global). They're top-level dynamic imports for the same reason.
const { _resetTxExecutorForTest, TxExecutorError, getTxExecutor } =
  await import("@/shared/sui/tx-executor");
const { warmHotWallet } = await import("@/shared/sui/hot-wallet");
const { Transaction: TxClass } = await import("@mysten/sui/transactions");
await warmHotWallet();

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("GasStationExecutor", () => {
  beforeEach(() => {
    _resetTxExecutorForTest();
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      fetchCalls.push({ url, init: init ?? {} });
      if (url.endsWith("/v1/reserve_gas")) {
        return jsonResp({
          result: {
            sponsor_address: SPONSOR_ADDR,
            reservation_id: 4242,
            gas_coins: [
              { objectId: "0xCOIN1", version: "100", digest: "DIGEST_COIN1" },
            ],
          },
          error: null,
        });
      }
      if (url.endsWith("/v1/execute_tx")) {
        return jsonResp({
          tx_block_response: fakeTxBlock,
          error: null,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
  });

  test("reserves a coin, signs as sender, executes via the pool", async () => {
    const exec = getTxExecutor("testnet");
    expect(exec.signerAddress()).toBe(HOT_ADDR);

    const tx = new TxClass();
    const result = await exec.execute(tx as unknown as Transaction);

    expect(setSenderMock).toHaveBeenCalledWith(HOT_ADDR);
    expect(setGasOwnerMock).toHaveBeenCalledWith(SPONSOR_ADDR);
    expect(setGasPaymentMock).toHaveBeenCalledTimes(1);
    expect(setGasBudgetMock).toHaveBeenCalledWith(500_000_000n);
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(signTransactionMock).toHaveBeenCalledTimes(1);

    expect(fetchCalls).toHaveLength(2);
    const reserve = fetchCalls[0]!;
    expect(reserve.url).toBe("http://gas.local:9527/v1/reserve_gas");
    expect((reserve.init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-bearer",
    );
    const reserveBody = JSON.parse(reserve.init.body as string);
    expect(reserveBody).toEqual({
      gas_budget: 500_000_000,
      reserve_duration_secs: 30,
    });

    const exec2 = fetchCalls[1]!;
    expect(exec2.url).toBe("http://gas.local:9527/v1/execute_tx");
    const execBody = JSON.parse(exec2.init.body as string);
    expect(execBody.reservation_id).toBe(4242);
    expect(execBody.user_sig).toBe("BASE64_USER_SIG");
    // tx_bytes is base64 of [0xab,0xcd,0xef]
    expect(Buffer.from(execBody.tx_bytes, "base64")).toEqual(
      Buffer.from([0xab, 0xcd, 0xef]),
    );
    expect(execBody.options).toEqual({
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    });

    // Translation produces the gRPC-shaped ExecutedTx without re-fetch.
    expect(result.digest).toBe(DIGEST);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.eventType).toBe("0x1::test::Event");
    expect((result.events[0] as unknown as { json: unknown }).json).toEqual({
      hello: "world",
    });
    expect(result.objectTypes).toEqual({
      "0xCREATED1": "0x1::test::Object",
      "0xMUTATED1": "0x1::other::Object",
    });
    expect(result.effects.changedObjects).toHaveLength(2);
    const [created, mutated] = result.effects.changedObjects;
    expect(created!.objectId).toBe("0xCREATED1");
    expect(created!.idOperation).toBe("Created");
    expect(
      created!.outputOwner as unknown as {
        $kind: string;
        AddressOwner: string;
      },
    ).toEqual({ $kind: "AddressOwner", AddressOwner: HOT_ADDR });
    expect(mutated!.idOperation).toBe("Mutated");
    expect(mutated!.outputOwner).toBeNull();
  });

  test("propagates reserve_gas error body", async () => {
    globalThis.fetch = (async (_url: RequestInfo | URL) => {
      return jsonResp({ result: null, error: "no coins available" });
    }) as typeof fetch;
    _resetTxExecutorForTest();
    const exec = getTxExecutor("testnet");
    const tx = new TxClass();
    await expect(exec.execute(tx as unknown as Transaction)).rejects.toThrow(
      /no coins available/,
    );
  });

  test("reserve_gas failure tagged phase=preflight (cap untouched)", async () => {
    globalThis.fetch = (async (_url: RequestInfo | URL) => {
      return jsonResp({ result: null, error: "no coins available" });
    }) as typeof fetch;
    _resetTxExecutorForTest();
    const exec = getTxExecutor("testnet");
    const tx = new TxClass();
    let err: unknown;
    try {
      await exec.execute(tx as unknown as Transaction);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TxExecutorError);
    expect((err as InstanceType<typeof TxExecutorError>).phase).toBe(
      "preflight",
    );
  });

  test("Move abort tagged phase=reverted (atomic rollback, cap untouched)", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/v1/reserve_gas")) {
        return jsonResp({
          result: {
            sponsor_address: SPONSOR_ADDR,
            reservation_id: 9,
            gas_coins: [{ objectId: "0xC", version: "1", digest: "D" }],
          },
          error: null,
        });
      }
      // execute_tx HTTP-200 with a chain-level revert.
      return jsonResp({
        tx_block_response: {
          digest: "ABORTED_DIGEST",
          effects: {
            status: { status: "failure", error: "MoveAbort(...) location=..." },
          },
        },
        error: null,
      });
    }) as typeof fetch;
    _resetTxExecutorForTest();
    const exec = getTxExecutor("testnet");
    const tx = new TxClass();
    let err: unknown;
    try {
      await exec.execute(tx as unknown as Transaction);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TxExecutorError);
    expect((err as InstanceType<typeof TxExecutorError>).phase).toBe(
      "reverted",
    );
    expect((err as InstanceType<typeof TxExecutorError>).digest).toBe(
      "ABORTED_DIGEST",
    );
  });

  test("execute_tx HTTP failure tagged phase=unknown (cap may be burned)", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/v1/reserve_gas")) {
        return jsonResp({
          result: {
            sponsor_address: SPONSOR_ADDR,
            reservation_id: 7,
            gas_coins: [{ objectId: "0xC", version: "1", digest: "D" }],
          },
          error: null,
        });
      }
      // Simulate the gas-pool returning an error mid-flight: we cannot
      // know whether the chain accepted the tx.
      return jsonResp({ error: "upstream timeout" });
    }) as typeof fetch;
    _resetTxExecutorForTest();
    const exec = getTxExecutor("testnet");
    const tx = new TxClass();
    let err: unknown;
    try {
      await exec.execute(tx as unknown as Transaction);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TxExecutorError);
    expect((err as InstanceType<typeof TxExecutorError>).phase).toBe("unknown");
  });
});

// restore fetch after the suite
globalThis.fetch = originalFetch;
