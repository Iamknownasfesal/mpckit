/**
 * Chain reconciliation: `discover` back-fills missing rows for caps
 * the operator owns on chain but the DB doesn't know about.
 *
 * Strategy: mock the gRPC client's `listOwnedObjects`, the Ika SDK's
 * `getPresign` + `getLatestNetworkEncryptionKey`, and the tx executor's
 * `signerAddress`. The DB is stubbed with an in-memory table that
 * mirrors only the call patterns this service hits (select, insert
 * with onConflictDoNothing + returning, eq).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

const NETWORK = "testnet";
const OPERATOR =
  "0x0000000000000000000000000000000000000000000000000000000000000aaa";
const NEK_ID = "0xnek";

mock.module("@/config/env", () => ({
  env: { LOG_LEVEL: "silent", NODE_ENV: "test" },
  defaultNetwork: () => NETWORK,
  enabledNetworks: () => [NETWORK],
  networkEnv: () => null,
  ALL_NETWORKS: ["testnet", "mainnet"],
}));

// drizzle-orm operators we only inspect, never execute against real PG.
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
type LtNode = {
  __op: "lt";
  col: { name: string };
  val: unknown;
};

mock.module("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown): EqNode => ({
    __op: "eq",
    col: col as EqNode["col"],
    val,
  }),
  and: (...args: Array<EqNode | AndNode>): AndNode => ({ __op: "and", args }),
  lt: (col: { name: string }, val: unknown): LtNode => ({
    __op: "lt",
    col,
    val,
  }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]): SqlNode => ({
    __op: "sql",
    strings,
    values,
  }),
}));

interface PresignRow {
  id: string;
  suiObjectId: string;
  network: string;
  curve: number;
  signatureAlgorithm: number;
  networkEncryptionKeyId: string;
  status: string;
  requestTxDigest: string | null;
  signRequestId: string | null;
  allocatedAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let presignRows: PresignRow[];
let insertCalls: Array<Partial<PresignRow>>;
let nextId: number;

function resetState() {
  presignRows = [];
  insertCalls = [];
  nextId = 1;
}

function genId(): string {
  const n = nextId++;
  return `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
}

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "";
  const sym = Symbol.for("drizzle:Name");
  return (t as Record<symbol, string>)[sym] ?? "";
}

function matchEq(row: Record<string, unknown>, node: EqNode): boolean {
  const map: Record<string, string> = {
    network: "network",
    sui_object_id: "suiObjectId",
    id: "id",
    status: "status",
  };
  const colName = node.col.name;
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
  projection?: Record<string, { name: string }>;
}

function selectBuilder(projection?: Record<string, { name: string }>) {
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
    limit(_n: number) {
      return b;
    },
    orderBy(_n: unknown) {
      return b;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle queries are thenable.
    then<TR1, TR2>(
      onFul?: (v: Array<Record<string, unknown>>) => TR1 | PromiseLike<TR1>,
      onRej?: (e: unknown) => TR2 | PromiseLike<TR2>,
    ): Promise<TR1 | TR2> {
      try {
        const name = tableName(state.table);
        if (name !== "presigns") {
          throw new Error(`unexpected select table ${name}`);
        }
        const rows = presignRows.filter((r) =>
          matchWhere(r as unknown as Record<string, unknown>, state.where),
        );
        const projected = state.projection
          ? rows.map((r) => {
              const out: Record<string, unknown> = {};
              const map: Record<string, string> = {
                sui_object_id: "suiObjectId",
                id: "id",
              };
              for (const [key, colRef] of Object.entries(state.projection!)) {
                const colName = colRef.name;
                const jsKey = map[colName] ?? colName;
                out[key] = (r as unknown as Record<string, unknown>)[jsKey];
              }
              return out;
            })
          : rows;
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
  values?: Partial<PresignRow>[] | Partial<PresignRow>;
  onConflict?: boolean;
}

function insertBuilder(table: unknown) {
  const state: InsertState = { table };
  let returningArmed = false;
  const b = {
    values(v: Partial<PresignRow> | Partial<PresignRow>[]) {
      state.values = v;
      return b;
    },
    onConflictDoNothing(_: unknown) {
      state.onConflict = true;
      return b;
    },
    returning(_proj?: Record<string, unknown>) {
      returningArmed = true;
      return b;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle insert chains are awaited directly.
    then<TR1, TR2>(
      onFul?: (v: Array<Record<string, unknown>>) => TR1 | PromiseLike<TR1>,
      onRej?: (e: unknown) => TR2 | PromiseLike<TR2>,
    ): Promise<TR1 | TR2> {
      try {
        const valuesArr = Array.isArray(state.values)
          ? state.values
          : state.values
            ? [state.values]
            : [];
        const inserted: PresignRow[] = [];
        for (const v of valuesArr) {
          insertCalls.push(v);
          const dup = presignRows.find((r) => r.suiObjectId === v.suiObjectId);
          if (dup) {
            if (state.onConflict) continue;
            throw new Error("unique violation: presigns.sui_object_id");
          }
          const now = new Date();
          const row: PresignRow = {
            id: genId(),
            suiObjectId: v.suiObjectId!,
            network: v.network ?? NETWORK,
            curve: v.curve ?? 0,
            signatureAlgorithm: v.signatureAlgorithm ?? 0,
            networkEncryptionKeyId: v.networkEncryptionKeyId ?? "",
            status: v.status ?? "pending",
            requestTxDigest: v.requestTxDigest ?? null,
            signRequestId: null,
            allocatedAt: null,
            usedAt: null,
            createdAt: now,
            updatedAt: now,
          };
          presignRows.push(row);
          inserted.push(row);
        }
        return Promise.resolve(
          returningArmed
            ? (inserted as unknown as Array<Record<string, unknown>>)
            : [],
        ).then(onFul, onRej);
      } catch (e) {
        return Promise.reject(e).then(onFul, onRej) as Promise<TR1 | TR2>;
      }
    },
  };
  return b;
}

const fakeDb = {
  select: (proj?: Record<string, { name: string }>) => selectBuilder(proj),
  insert: (t: unknown) => insertBuilder(t),
};

mock.module("@/shared/db/client", () => ({
  getDb: () => fakeDb,
  isDbConfigured: () => true,
  closeDb: async () => undefined,
  schema: {},
}));

// Cap fixtures: A is already tracked, B is fresh + Completed, C throws on
// session lookup (RPC blip) and should be counted as `failed`.
const CAP_A = "0xCAPA";
const CAP_B = "0xCAPB";
const CAP_C = "0xCAPC";
const SESSION_B = "0xSESSB";
const SESSION_C = "0xSESSC";

const PRESIGN_CAP_TYPE = "0xpkg::coordinator_inner::UnverifiedPresignCap";

const fakeSuiClient = {
  core: {
    listOwnedObjects: mock(async (_args: unknown) => ({
      objects: [
        { objectId: CAP_A, type: PRESIGN_CAP_TYPE },
        { objectId: CAP_B, type: PRESIGN_CAP_TYPE },
        { objectId: CAP_C, type: PRESIGN_CAP_TYPE },
        // Irrelevant object that must not be counted.
        { objectId: "0xCOIN", type: "0x2::coin::Coin<0x2::sui::SUI>" },
      ],
      hasNextPage: false,
      cursor: null,
    })),
    getObjects: mock(async (args: { objectIds: string[] }) => {
      const id = args.objectIds[0];
      if (id === CAP_B) {
        return {
          objects: [{ json: { presign_id: SESSION_B } }],
        };
      }
      if (id === CAP_C) {
        return {
          objects: [{ json: { presign_id: SESSION_C } }],
        };
      }
      throw new Error(`unexpected getObjects id ${id}`);
    }),
  },
};

mock.module("@/shared/sui/client", () => ({
  getSuiClient: () => fakeSuiClient,
}));

const fakeIkaClient = {
  getLatestNetworkEncryptionKey: mock(async () => ({ id: NEK_ID })),
  getPresign: mock(async (sessionId: string) => {
    if (sessionId === SESSION_B) {
      return {
        curve: 0,
        signature_algorithm: 0,
        state: { $kind: "Completed" },
      };
    }
    // SESSION_C: simulate an RPC hiccup, exercising the per-cap try/catch.
    throw new Error("transient RPC failure for SESSION_C");
  }),
};

mock.module("@/shared/ika/client", () => ({
  getIkaClient: async () => fakeIkaClient,
}));

mock.module("@/shared/sui/tx-executor", () => ({
  getTxExecutor: () => ({
    signerAddress: () => OPERATOR,
  }),
}));

// Imports must follow the mocks above so the service wires to stubs.
const { discover } = await import("@/features/presigns/service");
const { presigns } = await import("@/shared/db/schema");

function seedTrackedCap(suiObjectId: string) {
  presignRows.push({
    id: genId(),
    suiObjectId,
    network: NETWORK,
    curve: 0,
    signatureAlgorithm: 0,
    networkEncryptionKeyId: NEK_ID,
    status: "ready",
    requestTxDigest: "0xseed",
    signRequestId: null,
    allocatedAt: null,
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("presigns.discover", () => {
  beforeEach(() => {
    resetState();
    fakeSuiClient.core.listOwnedObjects.mockClear();
    fakeSuiClient.core.getObjects.mockClear();
    fakeIkaClient.getPresign.mockClear();
    fakeIkaClient.getLatestNetworkEncryptionKey.mockClear();
  });

  test("inserts one row per untracked cap, skips tracked, counts failures", async () => {
    seedTrackedCap(CAP_A);

    const result = await discover(NETWORK);

    expect(result).toEqual({
      scanned: 3,
      alreadyTracked: 1,
      inserted: 1,
      failed: 1,
    });

    // Exactly one new row was written (CAP_B); CAP_A was skipped, CAP_C
    // failed the session lookup and was deferred.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.suiObjectId).toBe(CAP_B);
    expect(insertCalls[0]!.status).toBe("ready");
    expect(insertCalls[0]!.requestTxDigest).toBeNull();
    expect(insertCalls[0]!.networkEncryptionKeyId).toBe(NEK_ID);

    // The persisted row reflects what was inserted.
    const newRow = presignRows.find((r) => r.suiObjectId === CAP_B);
    expect(newRow).toBeDefined();
    expect(newRow!.status).toBe("ready");

    // Sui owner scan happened once (single page), session resolution
    // ran for both untracked caps (B + C).
    expect(fakeSuiClient.core.listOwnedObjects).toHaveBeenCalledTimes(1);
    expect(fakeSuiClient.core.getObjects).toHaveBeenCalledTimes(2);
  });

  test("non-Completed presigns are inserted as pending so promotePending picks them up", async () => {
    // Re-stub getPresign so CAP_B returns Requested instead of Completed.
    fakeIkaClient.getPresign.mockImplementation(async (id: string) => {
      if (id === SESSION_B) {
        return {
          curve: 2,
          signature_algorithm: 0,
          state: { $kind: "Requested" },
        };
      }
      throw new Error("nope");
    });

    const result = await discover(NETWORK);
    expect(result.inserted).toBe(1);
    expect(result.failed).toBe(2); // CAP_A no longer seeded as tracked; CAP_C still throws.
    const newRow = presignRows.find((r) => r.suiObjectId === CAP_B);
    expect(newRow!.status).toBe("pending");
    expect(newRow!.curve).toBe(2);
  });

  test("all-tracked input is a no-op insert", async () => {
    seedTrackedCap(CAP_A);
    seedTrackedCap(CAP_B);
    seedTrackedCap(CAP_C);

    const result = await discover(NETWORK);

    expect(result.scanned).toBe(3);
    expect(result.alreadyTracked).toBe(3);
    expect(result.inserted).toBe(0);
    expect(result.failed).toBe(0);
    expect(insertCalls).toHaveLength(0);
    // No session resolution needed because every cap was already known.
    expect(fakeSuiClient.core.getObjects).not.toHaveBeenCalled();
    expect(fakeIkaClient.getPresign).not.toHaveBeenCalled();
  });

  test("references the presigns table (sanity check for mock wiring)", () => {
    // Guards against silent renames of the presigns schema export. If
    // the test runs at all, the import resolved; this just pins the
    // symbol so a future rename surfaces here, not in production.
    expect(presigns).toBeDefined();
  });
});
