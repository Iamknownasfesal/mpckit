/**
 * Audit L1: `chargeWithRefund` swallowed refund failures. Verify the
 * catch-block now logs structured error fields and bumps a counter
 * before rethrowing the original `fn()` error (caller contract is
 * unchanged; only observability is added).
 *
 * The DB layer is faked: `getOrCreateAccount` selects/inserts via
 * `db.select(...).from(...).where(...).limit(n)` and
 * `db.insert(...).values(...).onConflictDoNothing(...).returning()`,
 * and `charge`/`refund` wrap their writes in `db.transaction(cb)`. The
 * fake counts `transaction()` calls so we can make the first
 * (`charge`) succeed and the second (`refund`) throw.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// Silence the real pino transport; the test spies on `log.error` via
// the mocked module below.
const logSpy = {
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock((..._args: unknown[]) => undefined),
  debug: mock(() => undefined),
};
mock.module("@/config/log", () => ({ log: logSpy }));

mock.module("@/config/env", () => ({
  env: {
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    BILLING_PRICE_ENCRYPTION_KEY_MICRO: 1n,
    BILLING_PRICE_DKG_MICRO: 1n,
    BILLING_PRICE_SIGN_MICRO: 1n,
  },
}));

mock.module("@/shared/queue/client", () => ({
  enqueue: async () => undefined,
}));

mock.module("@/features/billing/verifier", () => ({
  verifyDeposit: async () => ({
    digest: "x",
    sender: "x",
    amountsAtomic: new Map(),
  }),
  creditsFor: () => ({ credits: 0n, rate: 0n }),
}));

mock.module("@/shared/billing/derive", () => ({
  deriveDepositAddress: () => "0xfake",
}));

// Fake drizzle. Each builder method returns the same object; the
// terminal methods (`limit`, `returning`) resolve with the rows the
// test pre-seeded for that call shape.
const FAKE_ACCOUNT = {
  id: "acc-1",
  userId: "user-1",
  network: "testnet",
  depositAddress: "0xfake",
  creditsMicro: 1_000_000n,
  updatedAt: new Date(),
};

const FAKE_CHARGE_ROW = {
  id: "charge-1",
  userId: "user-1",
  network: "testnet",
  opType: "test-op",
  opId: "op-1",
  kind: "charge",
  creditsMicro: -100n,
  reason: "test",
  createdAt: new Date(),
};

interface FakeDb {
  transactionCalls: number;
  refundTransactionShouldThrow: boolean;
}

const state: FakeDb = {
  transactionCalls: 0,
  refundTransactionShouldThrow: false,
};

function makeBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = chain;
  b.from = chain;
  b.where = chain;
  b.set = chain;
  b.update = chain;
  b.insert = chain;
  b.values = chain;
  b.onConflictDoNothing = chain;
  b.for = chain;
  b.orderBy = chain;
  b.limit = () => Promise.resolve(rows);
  b.returning = () => Promise.resolve(rows);
  return b;
}

const fakeTx = {
  select: () => makeBuilder([]), // no existing charge/refund row
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([FAKE_CHARGE_ROW]),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve(undefined),
    }),
  }),
  // The `for("update")` inside charge selects the account row.
  // makeBuilder above handles that path because `select()` returns the
  // chainable builder; tweak its `limit` resolution per call.
};

// Override fakeTx.select so the account `for update` query returns the
// account, but the dedupe lookup returns []. We dispatch by inspecting
// which call comes first: the dedupe `select` runs before the account
// `for update` select inside `charge`/`refund`.
let txSelectCallNo = 0;
fakeTx.select = () => {
  txSelectCallNo += 1;
  if (txSelectCallNo % 2 === 1) {
    // Dedupe lookup -> no existing row.
    return makeBuilder([]);
  }
  // Account `for update` lookup -> the account row.
  return makeBuilder([{ creditsMicro: FAKE_ACCOUNT.creditsMicro }]);
};

const fakeDb = {
  select: () => makeBuilder([FAKE_ACCOUNT]),
  insert: () => ({
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve([FAKE_ACCOUNT]),
      }),
      returning: () => Promise.resolve([FAKE_ACCOUNT]),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve(undefined),
    }),
  }),
  transaction: async <T>(cb: (tx: typeof fakeTx) => Promise<T>): Promise<T> => {
    state.transactionCalls += 1;
    // First transaction is `charge`, second is `refund`. If the test
    // asked for the refund call to throw, raise from inside the
    // transaction so it surfaces the same way a real DB outage would.
    if (state.refundTransactionShouldThrow && state.transactionCalls === 2) {
      throw new Error("simulated refund db outage");
    }
    return cb(fakeTx);
  },
};

mock.module("@/shared/db/client", () => ({
  getDb: () => fakeDb,
}));

// `prom-client`'s Counter has no public read-only accessor for the
// current value, but `hashMap` is internal and stable. Read it
// directly for assertion.
function counterValueWithLabels(
  counter: unknown,
  labels: Record<string, string>,
): number {
  // biome-ignore lint/suspicious/noExplicitAny: prom-client internals
  const map = (counter as any).hashMap as Record<
    string,
    { value: number; labels: Record<string, string> }
  >;
  for (const entry of Object.values(map)) {
    if (Object.entries(labels).every(([k, v]) => entry.labels[k] === v)) {
      return entry.value;
    }
  }
  return 0;
}

const { chargeWithRefund } = await import("@/features/billing/service");
const { billingRefundFailed } = await import("@/shared/cache/metrics");

const baseArgs = {
  userId: "user-1",
  network: "testnet",
  opType: "test-op",
  amountMicro: 100n,
  chargeReason: "test charge",
  refundReason: (err: unknown) => `refund: ${String(err)}`,
};

describe("chargeWithRefund happy path", () => {
  beforeEach(() => {
    state.transactionCalls = 0;
    state.refundTransactionShouldThrow = false;
    txSelectCallNo = 0;
    logSpy.error.mockClear();
  });

  test("returns fn() result and never enters refund branch", async () => {
    const result = await chargeWithRefund(baseArgs, async () => "ok");
    expect(result).toBe("ok");
    // Only the `charge` transaction ran.
    expect(state.transactionCalls).toBe(1);
    expect(logSpy.error).not.toHaveBeenCalled();
  });
});

describe("chargeWithRefund refund-on-throw", () => {
  beforeEach(() => {
    state.transactionCalls = 0;
    state.refundTransactionShouldThrow = false;
    txSelectCallNo = 0;
    logSpy.error.mockClear();
  });

  test("when fn throws and refund succeeds, rethrows the original error silently", async () => {
    const originalErr = new Error("fn blew up");
    await expect(
      chargeWithRefund(baseArgs, async () => {
        throw originalErr;
      }),
    ).rejects.toThrow(originalErr);
    // Both `charge` and `refund` ran.
    expect(state.transactionCalls).toBe(2);
    // Successful refund must not log an error.
    expect(logSpy.error).not.toHaveBeenCalled();
  });
});

describe("chargeWithRefund refund-failure observability (L1)", () => {
  beforeEach(() => {
    state.transactionCalls = 0;
    state.refundTransactionShouldThrow = true;
    txSelectCallNo = 0;
    logSpy.error.mockClear();
  });

  test("when fn throws AND refund throws: rethrows original err, logs both errs, bumps counter", async () => {
    const before = counterValueWithLabels(billingRefundFailed, {
      network: baseArgs.network,
      opType: baseArgs.opType,
    });

    const originalErr = new Error("fn blew up");
    await expect(
      chargeWithRefund(baseArgs, async () => {
        throw originalErr;
      }),
    ).rejects.toThrow(originalErr);

    // Counter went up by exactly 1 for this label pair.
    const after = counterValueWithLabels(billingRefundFailed, {
      network: baseArgs.network,
      opType: baseArgs.opType,
    });
    expect(after - before).toBe(1);

    // Logger got an error call with the structured fields the audit
    // requires (originalErr + refundErr at minimum).
    expect(logSpy.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = logSpy.error.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(fields.originalErr).toBe(originalErr);
    expect(fields.refundErr).toBeInstanceOf(Error);
    expect((fields.refundErr as Error).message).toBe(
      "simulated refund db outage",
    );
    expect(fields.userId).toBe(baseArgs.userId);
    expect(fields.network).toBe(baseArgs.network);
    expect(fields.opType).toBe(baseArgs.opType);
    expect(fields.amountMicro).toBe("100");
    expect(typeof fields.opId).toBe("string");
    expect(typeof msg).toBe("string");
  });
});
