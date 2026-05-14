/**
 * Chain reconciliation: `discover` back-fills missing rows for caps
 * the operator owns on chain but the DB doesn't know about.
 *
 * Strategy: mock the gRPC client's `listOwnedObjects`, `getObjects`,
 * and `getDynamicField`, plus the tx executor's `signerAddress`. The
 * DB is stubbed with an in-memory table that mirrors only the call
 * patterns this service hits (select, insert with onConflictDoNothing
 * + returning, eq).
 *
 * The NEK assertion is the load-bearing one: the `PresignSession`'s
 * `b"dwallet_network_encryption_key_id"` dynamic field is the canonical
 * source the coordinator reads in `validate_and_initiate_sign`, so the
 * inserted row's NEK must match that field exactly (NOT some "latest"
 * key the operator has rotated to since).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const NETWORK = "testnet";
const OPERATOR =
  "0x0000000000000000000000000000000000000000000000000000000000000aaa";
// NEK encoded into the dynamic field on each PresignSession. The test
// also seeds a different "latest" NEK to prove the row uses the field
// NEK, not the operator's current key.
const FIELD_NEK_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const LATEST_NEK_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000099";

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
type DescNode = { __op: "desc"; col: { name: string } };

// IMPORTANT: enumerate every drizzle-orm export touched by ANY module
// the in-process suite loads, not just the ones this test exercises.
// Bun's `mock.module` shapes the module record once on first call,
// and ESM bindings are static, so a later `mock.module("drizzle-orm",
// {...desc...})` in sibling files cannot add `desc` to the shape we
// printed here. The billing service imports `desc`, so omitting it
// would surface as `SyntaxError: Export named 'desc' not found` when
// billing tests run after this file.
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
  desc: (col: { name: string }): DescNode => ({ __op: "desc", col }),
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

// Cap fixtures.
const CAP_A = "0xCAPA";
const CAP_B = "0xCAPB";
const CAP_C = "0xCAPC";
const CAP_D = "0xCAPD";
const SESSION_A = "0xSESSA";
const SESSION_B = "0xSESSB";
const SESSION_C = "0xSESSC";
const SESSION_D_MISSING = "0xSESSD_NEK_MISSING";

const PRESIGN_CAP_TYPE = "0xpkg::coordinator_inner::UnverifiedPresignCap";

// Map cap -> session
const CAP_TO_SESSION: Record<string, string> = {
  [CAP_A]: SESSION_A,
  [CAP_B]: SESSION_B,
  [CAP_C]: SESSION_C,
  [CAP_D]: SESSION_D_MISSING,
};

// Per-session curve / signature_algorithm.
const SESSION_PARAMS: Record<
  string,
  { curve: number; signature_algorithm: number }
> = {
  [SESSION_A]: { curve: 0, signature_algorithm: 0 },
  [SESSION_B]: { curve: 0, signature_algorithm: 0 },
  [SESSION_C]: { curve: 2, signature_algorithm: 1 },
  [SESSION_D_MISSING]: { curve: 0, signature_algorithm: 0 },
};

// Sessions whose NEK dynamic field deliberately throws (simulating
// `getDynamicField` failure when the field is absent or the RPC fails).
const SESSION_NEK_MISSING = new Set<string>([SESSION_D_MISSING]);

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = h.padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

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
      const objects = args.objectIds.map((id) => {
        // Cap content: { presign_id }.
        const session = CAP_TO_SESSION[id];
        if (session) {
          return { json: { presign_id: session } };
        }
        // Session content: { curve, signature_algorithm }.
        const params = SESSION_PARAMS[id];
        if (params) {
          return { json: params };
        }
        return new Error(`unknown id ${id}`);
      });
      return { objects };
    }),
    getDynamicField: mock(
      async (args: {
        parentId: string;
        name: { type: string; bcs: Uint8Array };
      }) => {
        if (SESSION_NEK_MISSING.has(args.parentId)) {
          throw new Error(`no NEK dynamic field on ${args.parentId}`);
        }
        return {
          dynamicField: {
            value: { type: "0x2::object::ID", bcs: hexToBytes(FIELD_NEK_ID) },
          },
        };
      },
    ),
  },
};

mock.module("@/shared/sui/client", () => ({
  getSuiClient: () => fakeSuiClient,
}));

// `getIkaClient` is no longer touched by `discover`, but other code paths
// in the service file still import it. Stub it harmlessly. If it gets
// called, the test should fail loudly.
const fakeIkaClient = {
  getLatestNetworkEncryptionKey: mock(async () => ({ id: LATEST_NEK_ID })),
  getPresign: mock(async (_id: string) => {
    throw new Error("getPresign must not be called by discover");
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
    networkEncryptionKeyId: FIELD_NEK_ID,
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
    fakeSuiClient.core.getDynamicField.mockClear();
    fakeIkaClient.getPresign.mockClear();
    fakeIkaClient.getLatestNetworkEncryptionKey.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  test("binds inserted row to dynamic-field NEK, not operator latest", async () => {
    const result = await discover(NETWORK);

    expect(result).toEqual({
      scanned: 3,
      alreadyTracked: 0,
      inserted: 3,
      failed: 0,
    });

    expect(insertCalls).toHaveLength(3);
    for (const row of insertCalls) {
      // The decisive assertion: every row picks up the NEK read from
      // the PresignSession's dynamic field, NOT the operator's current
      // key.
      expect(row.networkEncryptionKeyId).toBe(FIELD_NEK_ID);
      expect(row.networkEncryptionKeyId).not.toBe(LATEST_NEK_ID);
      expect(row.status).toBe("pending");
    }
    // Status promotion is the cron's job. We never call getPresign or
    // getLatestNetworkEncryptionKey from discover anymore.
    expect(fakeIkaClient.getPresign).not.toHaveBeenCalled();
    expect(fakeIkaClient.getLatestNetworkEncryptionKey).not.toHaveBeenCalled();
  });

  test("skips already-tracked caps and inserts only the new ones", async () => {
    seedTrackedCap(CAP_A);

    const result = await discover(NETWORK);

    expect(result).toEqual({
      scanned: 3,
      alreadyTracked: 1,
      inserted: 2,
      failed: 0,
    });
    expect(insertCalls).toHaveLength(2);
    const insertedIds = insertCalls.map((r) => r.suiObjectId);
    expect(insertedIds).toContain(CAP_B);
    expect(insertedIds).toContain(CAP_C);
  });

  test("dynamic-field lookup throwing counts as failed, not inserted", async () => {
    // Inject a fourth cap whose session deliberately has no NEK dynamic
    // field. The cap must be counted as failed (retry next pass), not
    // silently inserted.
    fakeSuiClient.core.listOwnedObjects.mockImplementationOnce(async () => ({
      objects: [
        { objectId: CAP_A, type: PRESIGN_CAP_TYPE },
        { objectId: CAP_D, type: PRESIGN_CAP_TYPE },
      ],
      hasNextPage: false,
      cursor: null,
    }));

    const result = await discover(NETWORK);

    expect(result.scanned).toBe(2);
    expect(result.inserted).toBe(1); // only CAP_A landed
    expect(result.failed).toBe(1); // CAP_D's NEK dynamic field threw
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.suiObjectId).toBe(CAP_A);
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
    // No cap-content or dynamic-field lookups needed because every cap
    // was already tracked.
    expect(fakeSuiClient.core.getObjects).not.toHaveBeenCalled();
    expect(fakeSuiClient.core.getDynamicField).not.toHaveBeenCalled();
  });

  test("references the presigns table (sanity check for mock wiring)", () => {
    // Guards against silent renames of the presigns schema export. If
    // the test runs at all, the import resolved; this just pins the
    // symbol so a future rename surfaces here, not in production.
    expect(presigns).toBeDefined();
  });
});
