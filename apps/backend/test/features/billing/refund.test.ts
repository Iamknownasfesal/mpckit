/**
 * Refund clamp + idempotency.
 *
 * Pins audit finding L2: the `refund` path validates that the requested
 * amount cannot exceed the not-yet-refunded portion of the matching
 * `(network, opType, opId, kind=charge)` rows, and that a refund without
 * any matching charge fails closed.
 *
 * Strategy: mock `drizzle-orm` operators + `getDb` with an in-memory
 * fake that interprets only the call patterns the billing service uses.
 * Drizzle column objects expose `.name` and `.table`, which is enough
 * to identify which column an `eq(...)` references without invoking
 * real Postgres or the drizzle SQL builder.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const NETWORK = "testnet";

mock.module("@/config/env", () => ({
  env: {
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    BILLING_MIN_DEPOSIT_MICRO: 1,
    BILLING_PRICE_ENCRYPTION_KEY_MICRO: 1000n,
    BILLING_PRICE_DKG_MICRO: 1000n,
    BILLING_PRICE_SIGN_MICRO: 1000n,
    BILLING_ACCEPTED_COIN_TYPES: [],
    BILLING_USD_PRICES: {},
    BILLING_COIN_DECIMALS: {},
    BILLING_COINGECKO_IDS: {},
    BILLING_PRICE_FEED_REFRESH_SEC: 3600,
    BILLING_DEPOSIT_MASTER_SEED_HEX: "00".repeat(32),
  },
  defaultNetwork: () => "testnet",
  enabledNetworks: () => ["testnet"],
  networkEnv: () => null,
  ALL_NETWORKS: ["testnet", "mainnet"],
}));

// Operator mocks. We need them to be inspectable so the fake db can
// walk a `where` tree and match it against in-memory rows.
type EqNode = {
  __op: "eq";
  col: { name: string; table: unknown };
  val: unknown;
};
type AndNode = { __op: "and"; args: Array<EqNode | AndNode> };
type SqlNode = {
  __op: "sql";
  strings: TemplateStringsArray;
  values: unknown[];
};
type DescNode = { __op: "desc"; col: { name: string } };

mock.module("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown): EqNode => ({
    __op: "eq",
    col: col as EqNode["col"],
    val,
  }),
  and: (...args: Array<EqNode | AndNode>): AndNode => ({ __op: "and", args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]): SqlNode => ({
    __op: "sql",
    strings,
    values,
  }),
  desc: (col: { name: string }): DescNode => ({ __op: "desc", col }),
}));

// Each test resets these via `resetState()`. Defined at module scope so
// the fake `getDb` and the assertions both see the same arrays.
let accounts: Array<{
  id: string;
  userId: string;
  network: string;
  creditsMicro: bigint;
  depositAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;
let charges: Array<{
  id: string;
  userId: string;
  network: string;
  opType: string;
  opId: string;
  kind: string;
  creditsMicro: bigint;
  reason: string | null;
  createdAt: Date;
}>;
let nextId: number;

function resetState() {
  accounts = [];
  charges = [];
  nextId = 1;
}

function genId(): string {
  const n = nextId++;
  return `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
}

function tableName(t: unknown): string {
  // Drizzle stores the original table name under a well-known symbol.
  if (!t || typeof t !== "object") return "";
  const sym = Symbol.for("drizzle:Name");
  return (t as Record<symbol, string>)[sym] ?? "";
}

function rowsFor(t: unknown): Array<Record<string, unknown>> {
  const name = tableName(t);
  if (name === "billing_accounts")
    return accounts as Array<Record<string, unknown>>;
  if (name === "billing_charges")
    return charges as Array<Record<string, unknown>>;
  throw new Error(`unexpected table ${name}`);
}

function matchEq(row: Record<string, unknown>, node: EqNode): boolean {
  const colName = node.col.name;
  // The drizzle column object stores the original column name; our
  // in-memory rows use camelCase JS keys (mirroring drizzle's inferred
  // selects), so map between the two for the columns we touch.
  const map: Record<string, string> = {
    user_id: "userId",
    network: "network",
    op_type: "opType",
    op_id: "opId",
    kind: "kind",
    id: "id",
  };
  const jsKey = map[colName] ?? colName;
  return row[jsKey] === node.val;
}

function matchWhere(
  row: Record<string, unknown>,
  node: EqNode | AndNode | undefined,
): boolean {
  if (!node) return true;
  if (node.__op === "eq") return matchEq(row, node);
  return node.args.every((c) => matchWhere(row, c));
}

interface SelectState {
  table?: unknown;
  where?: EqNode | AndNode;
  limit?: number;
  projection?: Record<string, unknown>;
  forUpdate?: boolean;
}

function selectBuilder(projection?: Record<string, unknown>) {
  const state: SelectState = { projection };
  const b = {
    from(t: unknown) {
      state.table = t;
      return b;
    },
    where(node: EqNode | AndNode) {
      state.where = node;
      return b;
    },
    limit(n: number) {
      state.limit = n;
      return b;
    },
    for(_mode: string) {
      state.forUpdate = true;
      return b;
    },
    orderBy(_n: unknown) {
      return b;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle queries are intentionally thenable so `await db.select()...` resolves directly.
    then<TR1, TR2>(
      onFul?: (v: Array<Record<string, unknown>>) => TR1 | PromiseLike<TR1>,
      onRej?: (e: unknown) => TR2 | PromiseLike<TR2>,
    ): Promise<TR1 | TR2> {
      try {
        const rows = rowsFor(state.table).filter((r) =>
          matchWhere(r, state.where),
        );
        const limited =
          state.limit !== undefined ? rows.slice(0, state.limit) : rows;
        const projected = state.projection
          ? limited.map((r) => {
              const out: Record<string, unknown> = {};
              for (const [key, colRef] of Object.entries(state.projection!)) {
                const colName = (colRef as { name: string }).name;
                const map: Record<string, string> = {
                  credits_micro: "creditsMicro",
                  user_id: "userId",
                };
                const jsKey = map[colName] ?? colName;
                out[key] = r[jsKey];
              }
              return out;
            })
          : limited;
        return Promise.resolve(projected).then(onFul, onRej);
      } catch (e) {
        return Promise.reject(e).then(onFul, onRej) as Promise<TR1 | TR2>;
      }
    },
  };
  return b;
}

interface InsertState {
  table?: unknown;
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  onConflict?: boolean;
}

function applyInsert(state: InsertState): Array<Record<string, unknown>> {
  const valuesArr = Array.isArray(state.values)
    ? state.values
    : state.values
      ? [state.values]
      : [];
  const out: Array<Record<string, unknown>> = [];
  for (const v of valuesArr) {
    const name = tableName(state.table);
    if (name === "billing_accounts") {
      // Enforce the unique (userId, network) index that the real schema
      // declares; matches the .onConflictDoNothing() behaviour the
      // service relies on for the upsert dance.
      const dup = accounts.find(
        (a) => a.userId === v.userId && a.network === v.network,
      );
      if (dup) {
        if (state.onConflict) continue;
        throw new Error("unique violation: billing_accounts");
      }
      const row = {
        id: genId(),
        userId: v.userId as string,
        network: v.network as string,
        creditsMicro: (v.creditsMicro as bigint | undefined) ?? 0n,
        depositAddress: (v.depositAddress as string | null | undefined) ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      accounts.push(row);
      out.push(row as unknown as Record<string, unknown>);
    } else if (name === "billing_charges") {
      // (network, opType, opId, kind) is unique.
      const dup = charges.find(
        (c) =>
          c.network === v.network &&
          c.opType === v.opType &&
          c.opId === v.opId &&
          c.kind === v.kind,
      );
      if (dup) throw new Error("unique violation: billing_charges");
      const row = {
        id: genId(),
        userId: v.userId as string,
        network: v.network as string,
        opType: v.opType as string,
        opId: v.opId as string,
        kind: v.kind as string,
        creditsMicro: v.creditsMicro as bigint,
        reason: (v.reason as string | null | undefined) ?? null,
        createdAt: new Date(),
      };
      charges.push(row);
      out.push(row as unknown as Record<string, unknown>);
    } else {
      throw new Error(`unexpected insert table ${name}`);
    }
  }
  return out;
}

function insertBuilder(table: unknown) {
  const state: InsertState = { table };
  let returningArmed = false;
  const b = {
    values(v: Record<string, unknown> | Array<Record<string, unknown>>) {
      state.values = v;
      return b;
    },
    onConflictDoNothing(_: unknown) {
      state.onConflict = true;
      return b;
    },
    returning() {
      returningArmed = true;
      return b;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle insert chains are awaited directly.
    then<TR1, TR2>(
      onFul?: (v: Array<Record<string, unknown>>) => TR1 | PromiseLike<TR1>,
      onRej?: (e: unknown) => TR2 | PromiseLike<TR2>,
    ): Promise<TR1 | TR2> {
      try {
        const inserted = applyInsert(state);
        return Promise.resolve(returningArmed ? inserted : []).then(
          onFul,
          onRej,
        );
      } catch (e) {
        return Promise.reject(e).then(onFul, onRej) as Promise<TR1 | TR2>;
      }
    },
  };
  return b;
}

interface UpdateState {
  table?: unknown;
  set?: Record<string, unknown>;
  where?: EqNode | AndNode;
}

function applySql(
  row: Record<string, unknown>,
  node: SqlNode,
): bigint | number | string {
  // The service only uses sql`` for arithmetic of the form:
  //   sql`${col} + ${value}`  or  sql`${col} - ${value}`
  // Detect that exact shape by inspecting the values array.
  if (node.values.length === 2) {
    const left = node.values[0] as { name: string };
    const right = node.values[1] as bigint | number;
    const colName = left.name;
    const map: Record<string, string> = { credits_micro: "creditsMicro" };
    const jsKey = map[colName] ?? colName;
    const current = row[jsKey] as bigint;
    const text = node.strings.join("?");
    if (/\+/.test(text)) return (current as bigint) + (right as bigint);
    if (/-/.test(text)) return (current as bigint) - (right as bigint);
  }
  throw new Error("unsupported sql shape in test fake");
}

function applyUpdate(state: UpdateState): Array<Record<string, unknown>> {
  const rows = rowsFor(state.table).filter((r) => matchWhere(r, state.where));
  const updated: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    for (const [key, val] of Object.entries(state.set ?? {})) {
      if (val && typeof val === "object" && (val as SqlNode).__op === "sql") {
        row[key] = applySql(row, val as SqlNode);
      } else {
        row[key] = val;
      }
    }
    updated.push(row);
  }
  return updated;
}

function updateBuilder(table: unknown) {
  const state: UpdateState = { table };
  let returningArmed = false;
  const b = {
    set(s: Record<string, unknown>) {
      state.set = s;
      return b;
    },
    where(node: EqNode | AndNode) {
      state.where = node;
      return b;
    },
    returning(_proj?: Record<string, unknown>) {
      returningArmed = true;
      return b;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle update chains are awaited directly.
    then<TR1, TR2>(
      onFul?: (v: Array<Record<string, unknown>>) => TR1 | PromiseLike<TR1>,
      onRej?: (e: unknown) => TR2 | PromiseLike<TR2>,
    ): Promise<TR1 | TR2> {
      try {
        const rows = applyUpdate(state);
        return Promise.resolve(returningArmed ? rows : []).then(onFul, onRej);
      } catch (e) {
        return Promise.reject(e).then(onFul, onRej) as Promise<TR1 | TR2>;
      }
    },
  };
  return b;
}

function makeTxLike() {
  return {
    select: (proj?: Record<string, unknown>) => selectBuilder(proj),
    insert: (t: unknown) => insertBuilder(t),
    update: (t: unknown) => updateBuilder(t),
  };
}

const fakeDb = {
  ...makeTxLike(),
  transaction: async <T>(
    fn: (tx: ReturnType<typeof makeTxLike>) => Promise<T>,
  ) => {
    // No real rollback; the service's logic is tested by asserting that
    // a thrown error leaves no partial state behind. The fake throws
    // before mutating account balance whenever the service does so.
    const snapshotAccounts = accounts.map((a) => ({ ...a }));
    const snapshotCharges = charges.map((c) => ({ ...c }));
    try {
      return await fn(makeTxLike());
    } catch (e) {
      accounts = snapshotAccounts;
      charges = snapshotCharges;
      throw e;
    }
  },
};

mock.module("@/shared/db/client", () => ({
  getDb: () => fakeDb,
  isDbConfigured: () => true,
  closeDb: async () => undefined,
  schema: {},
}));

// Imports must follow the mocks above.
const { charge, refund, getBalance } = await import(
  "@/features/billing/service"
);

async function seedAccount(userId: string, network: string, credits: bigint) {
  accounts.push({
    id: genId(),
    userId,
    network,
    creditsMicro: credits,
    depositAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("billing.refund clamp + idempotency", () => {
  beforeEach(() => {
    resetState();
  });

  afterAll(() => {
    // Clear any `mock(...)` function spies this file created. Bun
    // 1.3.x does NOT undo `mock.module` registrations through
    // `mock.restore()`, but the `drizzle-orm` and `@/shared/db/client`
    // stubs here are full-surface so they remain forward-compatible
    // if a later file imports the same modules.
    mock.restore();
  });

  test("equal-to-charge refund restores balance exactly", async () => {
    await seedAccount(USER_ID, NETWORK, 10_000n);
    await charge({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-equal",
      amountMicro: 1_000n,
      reason: "charge",
    });
    expect(await getBalance(USER_ID, NETWORK)).toBe(9_000n);
    const r = await refund({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-equal",
      amountMicro: 1_000n,
      reason: "full refund",
    });
    expect(r.creditsMicro).toBe(1_000n);
    expect(await getBalance(USER_ID, NETWORK)).toBe(10_000n);
  });

  test("partial refund credits back exactly the partial amount", async () => {
    await seedAccount(USER_ID, NETWORK, 10_000n);
    await charge({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-partial",
      amountMicro: 1_000n,
      reason: "charge",
    });
    await refund({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-partial",
      amountMicro: 400n,
      reason: "partial",
    });
    expect(await getBalance(USER_ID, NETWORK)).toBe(9_400n);
  });

  test("refund > charge throws REFUND_EXCEEDS_CHARGE (422) and leaves balance unchanged", async () => {
    await seedAccount(USER_ID, NETWORK, 10_000n);
    await charge({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-over",
      amountMicro: 1_000n,
      reason: "charge",
    });
    const before = await getBalance(USER_ID, NETWORK);
    let thrown: unknown;
    try {
      await refund({
        userId: USER_ID,
        network: NETWORK,
        opType: "sign",
        opId: "op-over",
        amountMicro: 1_000_000_000n,
        reason: "buggy worker",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const err = thrown as { code?: string; status?: number };
    expect(err.code).toBe("REFUND_EXCEEDS_CHARGE");
    expect(err.status).toBe(422);
    expect(await getBalance(USER_ID, NETWORK)).toBe(before);
    // No refund row should have been written.
    expect(charges.filter((c) => c.kind === "refund").length).toBe(0);
  });

  test("refund without matching charge throws REFUND_NO_MATCHING_CHARGE (422)", async () => {
    await seedAccount(USER_ID, NETWORK, 10_000n);
    const before = await getBalance(USER_ID, NETWORK);
    let thrown: unknown;
    try {
      await refund({
        userId: USER_ID,
        network: NETWORK,
        opType: "sign",
        opId: "op-orphan",
        amountMicro: 500n,
        reason: "orphan refund",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const err = thrown as { code?: string; status?: number };
    expect(err.code).toBe("REFUND_NO_MATCHING_CHARGE");
    expect(err.status).toBe(422);
    expect(await getBalance(USER_ID, NETWORK)).toBe(before);
    expect(charges.length).toBe(0);
  });

  test("idempotent: second refund for the same opId returns the prior row without double-crediting", async () => {
    await seedAccount(USER_ID, NETWORK, 10_000n);
    await charge({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-idem",
      amountMicro: 1_000n,
      reason: "charge",
    });
    const first = await refund({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-idem",
      amountMicro: 1_000n,
      reason: "first call",
    });
    const balanceAfterFirst = await getBalance(USER_ID, NETWORK);
    const second = await refund({
      userId: USER_ID,
      network: NETWORK,
      opType: "sign",
      opId: "op-idem",
      amountMicro: 1_000n,
      reason: "retry",
    });
    expect(second.id).toBe(first.id);
    expect(await getBalance(USER_ID, NETWORK)).toBe(balanceAfterFirst);
    // Only one refund row, regardless of how many times the caller retried.
    expect(charges.filter((c) => c.kind === "refund").length).toBe(1);
  });
});
