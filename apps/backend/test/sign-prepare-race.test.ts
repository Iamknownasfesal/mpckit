/**
 * Race regression for `prepareSignRequest` (audit finding M2).
 *
 * Old ordering: balance pre-check, insert prepared row, allocate presign,
 * then atomic chargeCredits. With balance == 1*sign price, N concurrent
 * prepares each passed the cheap pre-check, each allocated a presign,
 * but only one charge won. The losers left presigns stuck in `allocated`
 * until the 2-min sweep (TTL ~5min), draining warm inventory.
 *
 * New ordering: atomic chargeCredits FIRST, then row insert, then
 * allocate. Losers 402 before touching the pool. If allocation fails
 * after a successful charge, we refund explicitly.
 *
 * This file mocks every external dependency `service.ts` pulls in so it
 * stays a pure unit test (no Postgres, no Sui, no Ika).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Only mock things `prepareSignRequest` actually touches at runtime, and
// keep mocks compatible with other test files in this process. Bun's
// `mock.module` is process-global and persists across files, so any
// over-aggressive stub here would corrupt downstream tests
// (move-calls.test.ts, tx-executor-gas-station.test.ts, smoke.test.ts).
const envMock: Record<string, unknown> = {
  LOG_LEVEL: "silent",
  PRESIGN_BATCH_SIZE: 10,
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

// ── In-memory billing + db state ────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
const NETWORK = "testnet";
const SIGN_PRICE = 1000n;

// One-shot mutex over balance + charge ledger. Mirrors the postgres
// `SELECT … FOR UPDATE` semantics in billing/service.ts::charge.
let balance = 0n;
const charges = new Map<string, bigint>();

async function withBalanceLock<T>(fn: () => Promise<T> | T): Promise<T> {
  // Yield once so concurrent awaits interleave (bun's scheduler runs
  // microtasks FIFO; the await here forces the queue to flush).
  await Promise.resolve();
  return fn();
}

const billingMock = {
  OP_PRICES: { sign: SIGN_PRICE },
  charge: mock(
    async (args: {
      userId: string;
      network: string;
      opType: string;
      opId: string;
      amountMicro: bigint;
      reason?: string;
    }) => {
      return withBalanceLock(() => {
        const key = `${args.network}:${args.opType}:${args.opId}:charge`;
        const existing = charges.get(key);
        if (existing !== undefined) return { id: key };
        if (balance < args.amountMicro) {
          const err = new (class extends Error {
            status = 402;
            code = "INSUFFICIENT_CREDITS";
          })(`insufficient credits: have ${balance}, need ${args.amountMicro}`);
          throw err;
        }
        balance -= args.amountMicro;
        charges.set(key, args.amountMicro);
        return { id: key };
      });
    },
  ),
  refund: mock(
    async (args: {
      userId: string;
      network: string;
      opType: string;
      opId: string;
      amountMicro: bigint;
      reason: string;
    }) => {
      return withBalanceLock(() => {
        const key = `${args.network}:${args.opType}:${args.opId}:refund`;
        if (charges.has(key)) return { id: key };
        balance += args.amountMicro;
        charges.set(key, args.amountMicro);
        return { id: key };
      });
    },
  ),
};

mock.module("@/features/billing/service", () => billingMock);

// Minimal DB stub. Backs the four touch points `prepareSignRequest`
// needs (idempotency select, dwallet select, signRequests insert/
// update/delete). We don't model presigns (the allocate mock supplies
// the presign row directly).
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

// Use the real schema (auth.test.ts also imports it; let it be the
// genuine drizzle table objects so we don't accidentally over-mock).
const { signRequests, dwallets } = await import("@/shared/db/schema");

function nameOf(t: unknown): string {
  const obj = t as Record<symbol, string>;
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    if (sym.toString().includes("Name")) return obj[sym] ?? "";
  }
  return "";
}

// Route selects by which table the service passed to `.from(...)`. The
// service makes two reads per prepare call: idempotency probe against
// `signRequests`, then a dwallet existence check against `dwallets`.
// Returning a constant per table keeps the stub order-independent so
// concurrent prepares don't interfere with each other.
const selectResponses: Record<string, unknown[]> = {};
let lastUpdateId: string | undefined;

function setSelectResponse(
  table: "signRequests" | "dwallets",
  rows: unknown[],
) {
  const t = table === "signRequests" ? signRequests : dwallets;
  selectResponses[nameOf(t)] = rows;
}

const db: {
  select: (...args: unknown[]) => unknown;
  insert: (table: unknown) => {
    values: (vals: SignRow) => { returning: () => Promise<SignRow[]> };
  };
  update: (table: unknown) => unknown;
  delete: (table: unknown) => unknown;
} = {
  // Replaced below once `selectResponses` is in scope.
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }),
  insert: (_table: unknown) => ({
    values: (vals: SignRow) => ({
      returning: async () => {
        signRows.set(vals.id, {
          ...vals,
          presignId: vals.presignId ?? null,
          updatedAt: vals.updatedAt ?? new Date(),
        });
        return [vals];
      },
    }),
  }),
  update: (_table: unknown) => ({
    set: (patch: Partial<SignRow>) => ({
      where: () => ({
        returning: async () => {
          // We don't have the predicate, so update the most recently
          // inserted row that matches the patch's id if provided, else
          // all rows. For our test we only update via signRequests.id
          // so we attach the id through closure: the service first
          // inserts then updates immediately.
          const lastId = lastUpdateId;
          if (lastId && signRows.has(lastId)) {
            const merged = { ...signRows.get(lastId)!, ...patch };
            signRows.set(lastId, merged);
            return [merged];
          }
          return [];
        },
      }),
    }),
  }),
  delete: (_table: unknown) => ({
    where: async () => {
      // Service calls delete after we've stashed lastUpdateId.
      if (lastUpdateId) signRows.delete(lastUpdateId);
      return undefined;
    },
  }),
};

db.select = () => ({
  from: (table: unknown) => ({
    where: () => ({
      limit: async () => selectResponses[nameOf(table)] ?? [],
    }),
  }),
});

// Capture the id passed to insert so update/delete can resolve to the
// same row (service passes an explicit `id`).
const originalInsert = db.insert.bind(db) as (table: unknown) => {
  values: (vals: SignRow) => { returning: () => Promise<SignRow[]> };
};
db.insert = (table: unknown) => {
  const orig = originalInsert(table);
  return {
    values: (vals: SignRow) => {
      lastUpdateId = vals.id;
      return orig.values(vals);
    },
  };
};

mock.module("@/shared/db/client", () => ({
  getDb: () => db,
  isDbConfigured: () => true,
  closeDb: async () => undefined,
  schema: undefined,
}));

// ── Presign allocator mock ─────────────────────────────────────────────

let allocateCalls = 0;
let allocateInventory = 1; // single ready presign by default

const allocateMock = mock(
  async (_args: {
    network: string;
    curve: number;
    signatureAlgorithm: number;
    signRequestId: string;
  }) => {
    allocateCalls += 1;
    await Promise.resolve(); // yield so concurrent allocs interleave
    if (allocateInventory <= 0) return undefined;
    allocateInventory -= 1;
    return {
      id: `presign-${allocateCalls}`,
      suiObjectId: "0xCAP",
    };
  },
);

mock.module("@/features/presigns/service", () => ({
  allocate: allocateMock,
  markConsumedPending: async () => undefined,
  markUsed: async () => undefined,
  rollbackToReady: async () => undefined,
}));

// Now import the service AFTER all mocks are wired.
const { prepareSignRequest } = await import("@/features/sign/service");

// ── Helpers ─────────────────────────────────────────────────────────────

function resetState() {
  balance = 0n;
  charges.clear();
  signRows.clear();
  allocateCalls = 0;
  allocateInventory = 1;
  lastUpdateId = undefined;
  for (const k of Object.keys(selectResponses)) delete selectResponses[k];
  billingMock.charge.mockClear();
  billingMock.refund.mockClear();
  allocateMock.mockClear();
}

const DWALLET_ROW = {
  id: "dw-1",
  userId: USER_ID,
  network: NETWORK,
  status: "active",
  curve: 0,
  suiDwalletId: "0xDW",
};

function prepareArgs(idempotencyKey: string) {
  return {
    userId: USER_ID,
    network: NETWORK as "testnet",
    idempotencyKey,
    dwalletId: "dw-1",
    signatureAlgorithm: 0,
    hashScheme: 1,
    message: new Uint8Array([0xab, 0xcd]),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("prepareSignRequest M2: charge before allocate", () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  test("concurrent prepares at balance == 1*price: only the winner reaches allocate", async () => {
    // Inventory=0 so the winner refunds itself after allocate fails;
    // the loser must bail at the charge gate, never touching the pool.
    balance = SIGN_PRICE;
    allocateInventory = 0;

    setSelectResponse("signRequests", []);
    setSelectResponse("dwallets", [DWALLET_ROW]);

    const results = await Promise.allSettled([
      prepareSignRequest(prepareArgs("key-a")),
      prepareSignRequest(prepareArgs("key-b")),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);

    const codes = results.map(
      (r) =>
        ((r as PromiseRejectedResult).reason as { code?: string }).code ?? "",
    );
    expect(codes.sort()).toEqual([
      "INSUFFICIENT_CREDITS",
      "PRESIGN_POOL_EMPTY",
    ]);

    // The loser bailed at charge; only the winner touched the pool.
    expect(allocateMock).toHaveBeenCalledTimes(1);

    // Winner: charge then refund. Loser: charge throws, no refund.
    expect(billingMock.charge).toHaveBeenCalledTimes(2);
    expect(billingMock.refund).toHaveBeenCalledTimes(1);
    expect(balance).toBe(SIGN_PRICE);
  });

  test("pool empty after successful charge: refund issued, original 422 thrown", async () => {
    balance = SIGN_PRICE;
    allocateInventory = 0;
    setSelectResponse("signRequests", []);
    setSelectResponse("dwallets", [DWALLET_ROW]);

    let thrown: unknown;
    try {
      await prepareSignRequest(prepareArgs("key-pool-empty"));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string }).code).toBe("PRESIGN_POOL_EMPTY");
    expect((thrown as { status?: number }).status).toBe(422);

    // Charge ran, then refund ran. Net balance restored.
    expect(billingMock.charge).toHaveBeenCalledTimes(1);
    expect(billingMock.refund).toHaveBeenCalledTimes(1);
    expect(balance).toBe(SIGN_PRICE);

    // Row was deleted on the pool-empty path.
    expect(signRows.size).toBe(0);
  });

  test("zero-balance prepare: charge throws before insert + before allocate", async () => {
    balance = 0n;
    allocateInventory = 5;
    setSelectResponse("signRequests", []);
    setSelectResponse("dwallets", [DWALLET_ROW]);

    let thrown: unknown;
    try {
      await prepareSignRequest(prepareArgs("key-zero"));
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { code?: string }).code).toBe("INSUFFICIENT_CREDITS");
    expect(allocateMock).toHaveBeenCalledTimes(0);
    expect(signRows.size).toBe(0);
    expect(billingMock.refund).toHaveBeenCalledTimes(0);
  });
});
