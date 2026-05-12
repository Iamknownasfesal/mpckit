import type { SuiClientTypes } from "@mysten/sui/client";
/**
 * Tx executor abstraction. Routes and workers don't sign transactions
 * directly. They build a `Transaction`, hand it to the executor, and get
 * back the digest + effects.
 *
 * One implementation, one wire path: `GasStationExecutor` calls Mysten's
 * `sui-gas-pool` daemon (still called `sui-gas-station` in env / docs)
 * over HTTP. The pool sponsors SUI from a managed coin pool, so the
 * operator hot wallet never holds gas — it only signs as the sender of
 * each PTB.
 *
 * The gas-pool removes contention on the gas coin, but not on the
 * other owned objects every PTB mutates: `OperatorCap` (and friends)
 * are still owned by the hot wallet, so concurrent submissions race
 * on their object versions. We serialise via a Redis distributed lock
 * around `execute()` so multi-pod backends can't fight over
 * OperatorCap. The gas-pool still parallelises the gas-coin half of
 * the submission, which is the part that needed a coin pool.
 *
 * We translate the gas-pool's JSON-RPC `SuiTransactionBlockResponse` to
 * our internal `ExecutedTx` shape directly instead of re-fetching the
 * tx through the gRPC client. Skipping that round-trip saves a few
 * hundred ms per PTB and is what makes the gas-pool path competitive
 * with raw `signAndExecute`. The translation only covers what callers
 * read (`changedObjects[].idOperation === "Created"`, `outputOwner`,
 * event `parsedJson`, `objectTypes` lookups); fields not on that hot
 * path are left empty.
 */
import type { Transaction } from "@mysten/sui/transactions";
import { env, type IkaNetwork } from "@/config/env";
import { log } from "@/config/log";
import { getNetwork } from "@/shared/networks/registry";
import { withLock } from "@/shared/redis/lock";
import { getSuiClient } from "@/shared/sui/client";
import {
  type ExecutedTx,
  getHotWallet,
  type HotWallet,
} from "@/shared/sui/hot-wallet";

export interface TxExecutor {
  /** Sui address that signs / sponsors. PTBs without a sender get this. */
  signerAddress(): string;

  /**
   * Submit `tx`. Throws on chain-level failure; returns the digest +
   * effects on success. Failures are wrapped in `TxExecutorError` so
   * callers can tell whether the tx ever reached the chain.
   */
  execute(tx: Transaction): Promise<ExecutedTx>;
}

/**
 * Phase of the executor pipeline that failed:
 *
 *   "preflight" — before the signed tx left the backend (reserve_gas
 *                 errored, build/sign threw, etc.). Owned objects
 *                 referenced in the PTB are *definitely* untouched.
 *
 *   "reverted"  — the chain ran the tx and aborted (Move abort,
 *                 effects.status.status === "failure"). Move execution
 *                 is atomic, so referenced objects are also untouched.
 *
 *   "unknown"   — the executor handed bytes to the gas-pool but failed
 *                 to read a clean response (HTTP timeout, malformed
 *                 body). The tx may or may not have landed; callers
 *                 must NOT assume input objects are still valid.
 */
export type TxFailurePhase = "preflight" | "reverted" | "unknown";

export class TxExecutorError extends Error {
  public readonly phase: TxFailurePhase;
  public readonly digest?: string;
  constructor(phase: TxFailurePhase, message: string, digest?: string) {
    super(message);
    this.phase = phase;
    this.digest = digest;
    this.name = "TxExecutorError";
  }
}

interface SuiObjectRef {
  objectId: string;
  version: string;
  digest: string;
}

interface ReserveGasResponse {
  result?: {
    sponsor_address: string;
    reservation_id: number;
    gas_coins: SuiObjectRef[];
  };
  error?: string | null;
}

interface JsonRpcStatus {
  status: "success" | "failure";
  error?: string;
}

interface JsonRpcOwner {
  AddressOwner?: string;
  ObjectOwner?: string;
  Shared?: { initial_shared_version: number };
}

interface JsonRpcObjectChange {
  type:
    | "published"
    | "transferred"
    | "mutated"
    | "deleted"
    | "wrapped"
    | "created";
  objectId?: string;
  objectType?: string;
  owner?: JsonRpcOwner | "Immutable";
}

interface JsonRpcEvent {
  type: string;
  packageId?: string;
  transactionModule?: string;
  sender?: string;
  parsedJson?: unknown;
  bcs?: string;
}

interface TxBlockResponse {
  digest: string;
  effects?: { status?: JsonRpcStatus } | null;
  events?: JsonRpcEvent[] | null;
  objectChanges?: JsonRpcObjectChange[] | null;
}

interface ExecuteTxResponse {
  effects?: { transactionDigest?: string } | null;
  tx_block_response?: TxBlockResponse | null;
  error?: string | null;
}

class GasStationExecutor implements TxExecutor {
  constructor(
    private readonly network: IkaNetwork,
    private readonly hotWallet: HotWallet,
    private readonly url: string,
    private readonly authToken: string,
    private readonly gasBudgetMist: bigint,
    private readonly reserveDurationSecs: number,
    private readonly lockKey: string,
  ) {}

  signerAddress(): string {
    return this.hotWallet.address();
  }

  async execute(tx: Transaction): Promise<ExecutedTx> {
    // Per-network Redis lock so concurrent submitters (this pod's
    // worker pool + sibling pods) don't race on OperatorCap + other
    // owned objects on a given chain. Cross-network execution is
    // independent (different caps) so the lock is keyed per-network.
    return withLock(this.lockKey, () => this.executeUnlocked(tx));
  }

  private async executeUnlocked(tx: Transaction): Promise<ExecutedTx> {
    if (!tx.getData().sender) tx.setSender(this.hotWallet.address());

    // 1. Reserve gas from the pool. Any failure here is preflight — no
    //    bytes left the backend.
    let reserved: NonNullable<ReserveGasResponse["result"]>;
    try {
      reserved = await this.reserveGas();
    } catch (err) {
      throw new TxExecutorError(
        "preflight",
        `reserve_gas failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. Pin gas owner / payment / budget to what the pool gave us.
    tx.setGasOwner(reserved.sponsor_address);
    tx.setGasPayment(reserved.gas_coins);
    tx.setGasBudget(this.gasBudgetMist);

    // 3. Build BCS bytes + sign as the sender. Anything thrown here is
    //    still preflight: the gas-pool hasn't seen the bytes.
    let txBytes: Uint8Array;
    let userSig: string;
    try {
      txBytes = await tx.build({ client: getSuiClient(this.network) });
      userSig = (await this.hotWallet.signTransaction(txBytes)).signature;
    } catch (err) {
      throw new TxExecutorError(
        "preflight",
        `tx build/sign failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 4. Hand to the pool for sponsor-sign + submit. Ask for the full
    //    tx block response so we can translate it locally and skip the
    //    gRPC re-fetch.
    //
    //    Once execute_tx is in flight we cannot prove the tx didn't
    //    reach the chain: a network timeout reading the response is
    //    indistinguishable from a clean submit + lost ACK. Anything
    //    thrown here is `unknown` so callers don't safely re-use input
    //    objects (e.g. presign caps that may have been consumed).
    let exec: ExecuteTxResponse;
    try {
      exec = await this.executeTx(reserved.reservation_id, txBytes, userSig);
    } catch (err) {
      throw new TxExecutorError(
        "unknown",
        `execute_tx failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const block = exec.tx_block_response;
    if (!block?.digest) {
      throw new TxExecutorError(
        "unknown",
        "gas-station executed tx but returned no tx_block_response",
      );
    }
    if (block.effects?.status?.status === "failure") {
      // Move execution is atomic: an abort means no objects mutated,
      // including referenced caps. Safe to roll back.
      throw new TxExecutorError(
        "reverted",
        `gas-station tx ${block.digest} reverted: ${block.effects.status.error ?? "unknown"}`,
        block.digest,
      );
    }
    return translateBlock(block);
  }

  private async reserveGas(): Promise<
    NonNullable<ReserveGasResponse["result"]>
  > {
    const res = await fetch(`${this.url}/v1/reserve_gas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({
        gas_budget: Number(this.gasBudgetMist),
        reserve_duration_secs: this.reserveDurationSecs,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `gas-station reserve_gas ${res.status}: ${(await res.text()).slice(0, 500)}`,
      );
    }
    const body = (await res.json()) as ReserveGasResponse;
    if (body.error || !body.result) {
      throw new Error(
        `gas-station reserve_gas error: ${body.error ?? "no result"}`,
      );
    }
    return body.result;
  }

  private async executeTx(
    reservationId: number,
    txBytes: Uint8Array,
    userSig: string,
  ): Promise<ExecuteTxResponse> {
    const res = await fetch(`${this.url}/v1/execute_tx`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({
        reservation_id: reservationId,
        tx_bytes: Buffer.from(txBytes).toString("base64"),
        user_sig: userSig,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(
        `gas-station execute_tx ${res.status}: ${(await res.text()).slice(0, 500)}`,
      );
    }
    const body = (await res.json()) as ExecuteTxResponse;
    if (body.error) {
      throw new Error(`gas-station execute_tx error: ${body.error}`);
    }
    return body;
  }
}

/**
 * Map the gas-pool's JSON-RPC response shape to the gRPC-shaped
 * `ExecutedTx` callers already consume. We synthesise just enough of
 * the gRPC shape that `shared/sui/effects.ts` keeps working:
 *   - `effects.changedObjects[].{objectId, idOperation, outputOwner}`
 *   - `events[].{eventType, parsedJson}`
 *   - `objectTypes` keyed by object id
 */
function translateBlock(block: TxBlockResponse): ExecutedTx {
  const objectTypes: Record<string, string> = {};
  const changedObjects: SuiClientTypes.TransactionEffects["changedObjects"] =
    [];
  for (const c of block.objectChanges ?? []) {
    if (!c.objectId) continue;
    if (c.objectType) objectTypes[c.objectId] = c.objectType;
    const idOperation = mapIdOperation(c.type);
    if (!idOperation) continue;
    changedObjects.push({
      objectId: c.objectId,
      idOperation,
      outputOwner: translateOwner(c.owner),
    } as SuiClientTypes.TransactionEffects["changedObjects"][number]);
  }
  const events: SuiClientTypes.Event[] = (block.events ?? []).map(
    (e) =>
      ({
        eventType: e.type,
        packageId: e.packageId,
        sender: e.sender,
        // gRPC `Event` uses `json` for the parsed payload; JSON-RPC
        // calls it `parsedJson`. Provide `json` since that's what the
        // sign service reads.
        json: e.parsedJson ?? null,
        // gRPC ships `bcs` as raw bytes; JSON-RPC ships base64.
        // `decodeDKGEvent` wraps with `new Uint8Array(ev.bcs)`, so we
        // hand it real bytes here.
        bcs: e.bcs ? new Uint8Array(Buffer.from(e.bcs, "base64")) : undefined,
      }) as unknown as SuiClientTypes.Event,
  );
  return {
    digest: block.digest,
    // Only the fields effects.ts touches are populated. Other consumers
    // would need a richer translation; we add fields when a real caller
    // shows up.
    effects: { changedObjects } as unknown as SuiClientTypes.TransactionEffects,
    events,
    objectTypes,
  };
}

function mapIdOperation(
  t: JsonRpcObjectChange["type"],
): "Created" | "Mutated" | undefined {
  if (t === "created") return "Created";
  if (t === "mutated" || t === "transferred") return "Mutated";
  return undefined; // published / deleted / wrapped — not consumed by callers today
}

function translateOwner(
  o: JsonRpcOwner | "Immutable" | undefined,
): SuiClientTypes.ObjectOwner | null {
  if (!o || o === "Immutable") return null;
  if (o.AddressOwner) {
    return {
      $kind: "AddressOwner",
      AddressOwner: o.AddressOwner,
    } as unknown as SuiClientTypes.ObjectOwner;
  }
  if (o.ObjectOwner) {
    return {
      $kind: "ObjectOwner",
      ObjectOwner: o.ObjectOwner,
    } as unknown as SuiClientTypes.ObjectOwner;
  }
  if (o.Shared) {
    return {
      $kind: "Shared",
      Shared: o.Shared,
    } as unknown as SuiClientTypes.ObjectOwner;
  }
  return null;
}

const _executors = new Map<IkaNetwork, TxExecutor>();

export function getTxExecutor(network: IkaNetwork): TxExecutor {
  const cached = _executors.get(network);
  if (cached) return cached;
  const { gasStation } = getNetwork(network);
  const exec = new GasStationExecutor(
    network,
    getHotWallet(),
    gasStation.url,
    gasStation.auth,
    env.SUI_GAS_STATION_BUDGET_MIST,
    env.SUI_GAS_STATION_RESERVE_SECS,
    `mpckit:tx-lock:${network}`,
  );
  _executors.set(network, exec);
  log.info(
    {
      network,
      url: gasStation.url,
      gasBudgetMist: env.SUI_GAS_STATION_BUDGET_MIST.toString(),
    },
    "tx-executor initialised (gas-station)",
  );
  return exec;
}

export function _resetTxExecutorForTest(): void {
  _executors.clear();
}
