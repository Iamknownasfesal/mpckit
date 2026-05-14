/**
 * NEK-aware presign allocation in `prepareSignRequest`.
 *
 * Three behaviours we pin down:
 *   1. A dwallet bound to NEK_A only pulls a presign with
 *      `network_encryption_key_id == NEK_A`, never NEK_B even within
 *      the same (curve, signatureAlgorithm) bucket.
 *   2. A bucket with zero matching-NEK presigns surfaces a
 *      `PRESIGN_POOL_EMPTY_FOR_NEK` 422 and refunds the upfront sign
 *      charge.
 *   3. A dwallet row whose `networkEncryptionKeyId` is still null
 *      (legacy rows from before the schema change) gets lazy-backfilled
 *      via `ensureDwalletNek` and proceeds normally.
 *
 * Strategy: spy on `allocate` so the test owns the presign inventory
 * + scoping logic, spy on billing `charge`/`refund` for ledger
 * assertions, and stub the dwallets module via `spyOn` for the row
 * lookup + the NEK backfill path. Same shape as `sign-prepare-race`.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

const envMock: Record<string, unknown> = {
  LOG_LEVEL: "silent",
  PRESIGN_BATCH_SIZE: 10,
  BILLING_PRICE_SIGN_MICRO: 1000n,
  BILLING_PRICE_DKG_MICRO: 1n,
  BILLING_PRICE_ENCRYPTION_KEY_MICRO: 1n,
};
mock.module("@/config/env", () => ({
  env: envMock,
  defaultNetwork: () => "testnet",
  enabledNetworks: () => ["testnet"],
  networkEnv: () => null,
  ALL_NETWORKS: ["testnet", "mainnet"],
}));

mock.module("@/config/log", () => ({
  log: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
}));

mock.module("@/shared/queue/client", () => ({
  enqueue: async () => undefined,
  registerHandler: () => undefined,
  schedule: async () => undefined,
  getBoss: async () => ({}),
  closeBoss: async () => undefined,
}));

const USER_ID = "00000000-0000-0000-0000-000000000001";
const NETWORK = "testnet";
const SIGN_PRICE = 1000n;

const NEK_A = "0xNEK_A";
const NEK_B = "0xNEK_B";

// Simple ledger.
let balance = 0n;
const chargeKeys = new Set<string>();
const refundKeys = new Set<string>();

const chargeImpl = mock(
  async (args: {
    userId: string;
    network: string;
    opType: string;
    opId: string;
    amountMicro: bigint;
    reason?: string;
  }) => {
    const key = `${args.opType}:${args.opId}`;
    if (chargeKeys.has(key)) return { id: key };
    if (balance < args.amountMicro) {
      const err = new (class extends Error {
        status = 402;
        code = "INSUFFICIENT_CREDITS";
      })(`insufficient credits`);
      throw err;
    }
    balance -= args.amountMicro;
    chargeKeys.add(key);
    return { id: key };
  },
);

const refundImpl = mock(
  async (args: {
    userId: string;
    network: string;
    opType: string;
    opId: string;
    amountMicro: bigint;
    reason: string;
  }) => {
    const key = `${args.opType}:${args.opId}:refund`;
    if (refundKeys.has(key)) return { id: key };
    balance += args.amountMicro;
    refundKeys.add(key);
    return { id: key };
  },
);

const realBilling = await import("@/features/billing/service");
const chargeSpy = spyOn(realBilling, "charge").mockImplementation(
  chargeImpl as typeof realBilling.charge,
);
const refundSpy = spyOn(realBilling, "refund").mockImplementation(
  refundImpl as typeof realBilling.refund,
);

// ── Presign inventory ───────────────────────────────────────────────────

interface PresignFixture {
  id: string;
  network: string;
  curve: number;
  signatureAlgorithm: number;
  networkEncryptionKeyId: string;
  suiObjectId: string;
}

let presignInventory: PresignFixture[] = [];

const allocateImpl = mock(
  async (args: {
    network: string;
    curve: number;
    signatureAlgorithm: number;
    networkEncryptionKeyId: string;
    signRequestId: string;
  }) => {
    await Promise.resolve();
    const idx = presignInventory.findIndex(
      (p) =>
        p.network === args.network &&
        p.curve === args.curve &&
        p.signatureAlgorithm === args.signatureAlgorithm &&
        p.networkEncryptionKeyId === args.networkEncryptionKeyId,
    );
    if (idx < 0) return undefined;
    const [picked] = presignInventory.splice(idx, 1);
    return picked;
  },
);

const realPresigns = await import("@/features/presigns/service");
const allocateSpy = spyOn(realPresigns, "allocate").mockImplementation(
  allocateImpl as typeof realPresigns.allocate,
);

// ── DB stub (minimal) ───────────────────────────────────────────────────

type SignRow = {
  id: string;
  userId: string;
  network: string;
  idempotencyKey: string;
  suiDwalletId: string;
  curve: number;
  signatureAlgorithm: number;
  hashScheme: number;
  messageHex: string;
  status: string;
  presignId: string | null;
  updatedAt: Date;
};
const signRows = new Map<string, SignRow>();

const { signRequests, dwallets } = await import("@/shared/db/schema");

function nameOf(t: unknown): string {
  const obj = t as Record<symbol, string>;
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    if (sym.toString().includes("Name")) return obj[sym] ?? "";
  }
  return "";
}

const selectResponses: Record<string, unknown[]> = {};
let lastUpdateId: string | undefined;

function setSelectResponse(
  table: "signRequests" | "dwallets",
  rows: unknown[],
) {
  const t = table === "signRequests" ? signRequests : dwallets;
  selectResponses[nameOf(t)] = rows;
}

const db = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => selectResponses[nameOf(table)] ?? [],
      }),
    }),
  }),
  insert: (_table: unknown) => ({
    values: (vals: SignRow) => {
      lastUpdateId = vals.id;
      return {
        returning: async () => {
          signRows.set(vals.id, {
            ...vals,
            presignId: vals.presignId ?? null,
            updatedAt: vals.updatedAt ?? new Date(),
          });
          return [vals];
        },
      };
    },
  }),
  update: (_table: unknown) => ({
    set: (patch: Partial<SignRow>) => ({
      where: () => ({
        returning: async () => {
          const id = lastUpdateId;
          if (id && signRows.has(id)) {
            const merged = { ...signRows.get(id)!, ...patch };
            signRows.set(id, merged);
            return [merged];
          }
          return [];
        },
      }),
    }),
  }),
  delete: (_table: unknown) => ({
    where: async () => {
      if (lastUpdateId) signRows.delete(lastUpdateId);
      return undefined;
    },
  }),
};

mock.module("@/shared/db/client", () => ({
  getDb: () => db,
  isDbConfigured: () => true,
  closeDb: async () => undefined,
  schema: undefined,
}));

// ── Dwallets module spy (ensureDwalletNek) ──────────────────────────────

let onChainNekFor: Record<string, string> = {};
let backfillCalls: Array<{ dwalletId: string; network: string }> = [];

const realDwallets = await import("@/features/dwallets/service");
const ensureNekSpy = spyOn(realDwallets, "ensureDwalletNek").mockImplementation(
  async (dwalletId: string, network: string) => {
    backfillCalls.push({ dwalletId, network });
    // Caller (sign service) already has the dwallet row. Our DB stub
    // returns it from `setSelectResponse("dwallets", ...)`. If that row
    // has a NEK we return it as-is; otherwise pretend we fetched the
    // chain dwallet, updated the row, and return the canonical NEK
    // from `onChainNekFor`.
    const dwRows = (selectResponses[nameOf(dwallets)] ?? []) as Array<{
      id: string;
      networkEncryptionKeyId?: string | null;
    }>;
    const dw = dwRows.find((r) => r.id === dwalletId);
    if (dw?.networkEncryptionKeyId) return dw.networkEncryptionKeyId;
    const fetched = onChainNekFor[dwalletId];
    if (!fetched) {
      throw new Error(`no on-chain NEK fixture for ${dwalletId}`);
    }
    // Mutate the row in place so subsequent reads see the backfilled
    // value, mirroring what the real implementation does in PG.
    if (dw) dw.networkEncryptionKeyId = fetched;
    return fetched;
  },
);

// Now import the service AFTER all mocks are wired.
const { prepareSignRequest } = await import("@/features/sign/service");

// ── Helpers ─────────────────────────────────────────────────────────────

function resetState() {
  balance = 0n;
  chargeKeys.clear();
  refundKeys.clear();
  signRows.clear();
  presignInventory = [];
  lastUpdateId = undefined;
  onChainNekFor = {};
  backfillCalls = [];
  for (const k of Object.keys(selectResponses)) delete selectResponses[k];
  chargeImpl.mockClear();
  refundImpl.mockClear();
  allocateImpl.mockClear();
  ensureNekSpy.mockClear();
}

function makePresign(nek: string, idx: number): PresignFixture {
  return {
    id: `presign-${nek}-${idx}`,
    network: NETWORK,
    curve: 0,
    signatureAlgorithm: 0,
    networkEncryptionKeyId: nek,
    suiObjectId: `0xCAP_${nek}_${idx}`,
  };
}

function dwalletRow(opts: { id: string; nek: string | null }) {
  return {
    id: opts.id,
    userId: USER_ID,
    network: NETWORK,
    status: "active",
    curve: 0,
    suiDwalletId: `0xDW_${opts.id}`,
    networkEncryptionKeyId: opts.nek,
  };
}

function prepareArgs(opts: { idempotencyKey: string; dwalletId: string }) {
  return {
    userId: USER_ID,
    network: NETWORK as "testnet",
    idempotencyKey: opts.idempotencyKey,
    dwalletId: opts.dwalletId,
    signatureAlgorithm: 0,
    hashScheme: 1,
    message: new Uint8Array([0xab, 0xcd]),
  };
}

// Suppress phase-2 RPCs the service kicks off after allocate succeeds.
// `fetchPresignBytes` reaches into the Sui client; we never want that
// to actually fire in unit tests.
mock.module("@/shared/sui/client", () => ({
  getSuiClient: () => ({
    core: {
      getObjects: async () => ({
        objects: [{ json: { presign_id: "0xSESS" } }],
      }),
    },
  }),
}));
mock.module("@/shared/ika/client", () => ({
  getIkaClient: async () => ({
    getPresignInParticularState: async () => ({
      state: { Completed: { presign: new Uint8Array([0x01]) } },
    }),
  }),
}));

// ── Tests ───────────────────────────────────────────────────────────────

describe("prepareSignRequest: NEK-aware allocation", () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  afterAll(() => {
    chargeSpy.mockRestore();
    refundSpy.mockRestore();
    allocateSpy.mockRestore();
    ensureNekSpy.mockRestore();
    mock.restore();
  });

  test("NEK_A dwallet ignores NEK_B presigns in the same bucket", async () => {
    balance = SIGN_PRICE * 5n;
    presignInventory = [
      makePresign(NEK_B, 1),
      makePresign(NEK_B, 2),
      makePresign(NEK_A, 1),
    ];

    setSelectResponse("signRequests", []);
    setSelectResponse("dwallets", [dwalletRow({ id: "dw-A", nek: NEK_A })]);

    const res = await prepareSignRequest(
      prepareArgs({ idempotencyKey: "k-A", dwalletId: "dw-A" }),
    );

    // We pulled the only NEK_A presign; the NEK_B presigns must still
    // be in the inventory untouched.
    expect(res.presignSuiObjectId).toBe(`0xCAP_${NEK_A}_1`);
    expect(presignInventory).toHaveLength(2);
    expect(
      presignInventory.every((p) => p.networkEncryptionKeyId === NEK_B),
    ).toBe(true);
    // allocate was called once, with the NEK_A arg.
    expect(allocateImpl).toHaveBeenCalledTimes(1);
    const callArgs = allocateImpl.mock.calls[0]?.[0] as
      | { networkEncryptionKeyId: string }
      | undefined;
    expect(callArgs?.networkEncryptionKeyId).toBe(NEK_A);
  });

  test("no matching NEK throws PRESIGN_POOL_EMPTY_FOR_NEK and refunds", async () => {
    balance = SIGN_PRICE;
    // Bucket has presigns but NONE under NEK_A; the dwallet is on NEK_A.
    presignInventory = [makePresign(NEK_B, 1), makePresign(NEK_B, 2)];

    setSelectResponse("signRequests", []);
    setSelectResponse("dwallets", [dwalletRow({ id: "dw-A", nek: NEK_A })]);

    let thrown: unknown;
    try {
      await prepareSignRequest(
        prepareArgs({ idempotencyKey: "k-empty-nek", dwalletId: "dw-A" }),
      );
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string }).code).toBe(
      "PRESIGN_POOL_EMPTY_FOR_NEK",
    );
    expect((thrown as { status?: number }).status).toBe(422);

    // Refund issued, balance restored.
    expect(chargeImpl).toHaveBeenCalledTimes(1);
    expect(refundImpl).toHaveBeenCalledTimes(1);
    expect(balance).toBe(SIGN_PRICE);
    // Row was deleted on the pool-empty path.
    expect(signRows.size).toBe(0);
    // The bucket's NEK_B presigns are still there.
    expect(presignInventory).toHaveLength(2);
  });

  test("dwallet row with null NEK is lazy-backfilled via ensureDwalletNek", async () => {
    balance = SIGN_PRICE;
    presignInventory = [makePresign(NEK_A, 1)];

    // The DB row has no NEK yet (legacy). `ensureDwalletNek` mock fills
    // it from `onChainNekFor`.
    onChainNekFor["dw-legacy"] = NEK_A;
    setSelectResponse("signRequests", []);
    setSelectResponse("dwallets", [dwalletRow({ id: "dw-legacy", nek: null })]);

    const res = await prepareSignRequest(
      prepareArgs({ idempotencyKey: "k-legacy", dwalletId: "dw-legacy" }),
    );

    // Backfill ran exactly once for this dwallet.
    expect(backfillCalls).toHaveLength(1);
    expect(backfillCalls[0]).toEqual({
      dwalletId: "dw-legacy",
      network: NETWORK,
    });
    // Allocate was called with the backfilled NEK.
    const callArgs = allocateImpl.mock.calls[0]?.[0] as
      | { networkEncryptionKeyId: string }
      | undefined;
    expect(callArgs?.networkEncryptionKeyId).toBe(NEK_A);
    // Resulting presign is the NEK_A cap.
    expect(res.presignSuiObjectId).toBe(`0xCAP_${NEK_A}_1`);
  });
});
