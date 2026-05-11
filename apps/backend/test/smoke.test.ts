/**
 * Smoke tests for Phase 1 read-only endpoints.
 *
 * No live testnet calls. Each test stubs the service layer with `mock.module`
 * so route handlers exercise their wiring (validation, shape, query parsing,
 * Prometheus emission, request-id round-trip) against deterministic data.
 *
 * Tests live in this file rather than alongside each route because Bun's
 * module mocking is process-global; centralising avoids cross-file leakage.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

// Stub `@/config/env` directly so test-order doesn't matter: bun's
// env.ts is parsed on first import (singleton) and `defaultNetwork()`
// + `requestNetwork()` would otherwise throw when other test files
// touch env first without our per-network process.env populated.
const ENV_STUB = {
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  HOT_WALLET_PROVIDER: "env",
  HOT_WALLET_SUI_SECRET_HEX: "11".repeat(32),
  PRICING_SAFETY_MULTIPLIER: 1.5,
  BILLING_ACCEPTED_COIN_TYPES: ["0x2::sui::SUI"],
  BILLING_USD_PRICES: { "0x2::sui::SUI": 1.0 },
  BILLING_COIN_DECIMALS: {},
  BILLING_COINGECKO_IDS: {},
  BILLING_PRICE_FEED_REFRESH_SEC: 3600,
};
mock.module("@/config/env", () => ({
  env: ENV_STUB,
  defaultNetwork: () => "testnet",
  enabledNetworks: () => ["testnet"],
  networkEnv: () => null,
  ALL_NETWORKS: ["testnet", "mainnet"],
}));

const FAKE_CONFIG = {
  packages: {
    ikaPackage: "0xPKG_IKA",
    ikaDwallet2pcMpcPackage: "0xPKG_DW2",
  },
  objects: {
    ikaDWalletCoordinator: { objectID: "0xCOORD" },
    ikaSystemObject: { objectID: "0xSYS" },
  },
};

const FAKE_NETWORK_INFO = {
  encryptionKeyId: "0xKEY",
  epoch: 42,
  loadedAt: 1_700_000_000_000,
};

const FAKE_PRICING = {
  loadedAt: 1_700_000_000_000,
  byKey: new Map<
    string,
    {
      feeIka: bigint;
      gasFeeReimbursementSui: bigint;
      gasFeeReimbursementSuiForSystemCalls: bigint;
    }
  >([
    [
      "0:0:5",
      {
        feeIka: 100n,
        gasFeeReimbursementSui: 200n,
        gasFeeReimbursementSuiForSystemCalls: 50n,
      },
    ],
    [
      "0:0:6",
      {
        feeIka: 300n,
        gasFeeReimbursementSui: 400n,
        gasFeeReimbursementSuiForSystemCalls: 75n,
      },
    ],
  ]),
  entries: [
    {
      key: { curve: 0, signatureAlgorithm: 0, protocol: 5 },
      value: {
        feeIka: 100n,
        gasFeeReimbursementSui: 200n,
        gasFeeReimbursementSuiForSystemCalls: 50n,
      },
    },
    {
      key: { curve: 0, signatureAlgorithm: 0, protocol: 6 },
      value: {
        feeIka: 300n,
        gasFeeReimbursementSui: 400n,
        gasFeeReimbursementSuiForSystemCalls: 75n,
      },
    },
  ],
};

const FAKE_PARAMS = {
  curve: "SECP256K1",
  encryptionKeyId: "0xKEY",
  epoch: 42,
  loadedAt: 1_700_000_000_000,
  bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
};

mock.module("../src/shared/ika/client", () => ({
  getIkaClient: async () => ({}),
  getIkaConfig: () => FAKE_CONFIG,
}));

mock.module("../src/features/network/service", () => ({
  getNetworkInfo: async () => FAKE_NETWORK_INFO,
}));

mock.module("../src/shared/networks/registry", () => ({
  getNetwork: () => ({
    ikaConfig: FAKE_CONFIG,
    sui: { core: {} },
    gasStation: { url: "http://gas.local:9527", auth: "test" },
    core: {
      packageId: "0x1",
      operatorCapId: "0x2",
      adminCapId: "0x3",
      treasuryId: "0x4",
    },
  }),
  hasNetwork: () => true,
  listNetworks: () => ["testnet"],
  warmupNetworks: async () => undefined,
}));

// Warm a real hot wallet so the /v1/network route can read its address
// without us module-mocking the hot-wallet module (which would leak
// into the hot-wallet.test.ts process-global mocks). Set the seed before
// importing the module so env.HOT_WALLET_SUI_SECRET_HEX is populated.
process.env.HOT_WALLET_SUI_SECRET_HEX = "11".repeat(32);
process.env.HOT_WALLET_PROVIDER = "env";
const { warmHotWallet, _resetHotWalletForTest } = await import(
  "../src/shared/sui/hot-wallet"
);
_resetHotWalletForTest();
await warmHotWallet();

mock.module("../src/features/pricing/service", () => {
  const Protocol = {
    DkgFirstRound: 0,
    DkgSecondRound: 1,
    ReEncryptUserShare: 2,
    MakeDwalletShared: 3,
    ImportedKeyVerification: 4,
    Presign: 5,
    Sign: 6,
    FutureSign: 7,
    SignWithPartialSignature: 8,
    DwalletDkg: 9,
    DwalletDkgWithSign: 10,
  } as const;
  return {
    Protocol,
    pricingKey: (
      curve: number,
      sigAlgo: number | null,
      protocol: number,
    ): string => `${curve}:${sigAlgo ?? "null"}:${protocol}`,
    getPricing: async (_net: string) => FAKE_PRICING,
    quoteSign: async (_net: string, curve: number, sigAlgo: number) => ({
      feeIka: 400n, // 100 + 300
      feeSui: 725n, // 200 + 50 + 400 + 75
      // SUI=$1, IKA=$0.05 (test fixture): (725 mist * $1 + 400 atomic * $0.05)
      // converted to microUSD. We hand the route a fixed value so the
      // /quote/sign assertion is deterministic regardless of feed state.
      feeMicroUsd: 21n,
      protocols: [
        {
          protocol: 5,
          value: FAKE_PRICING.byKey.get(`${curve}:${sigAlgo}:5`)!,
        },
        {
          protocol: 6,
          value: FAKE_PRICING.byKey.get(`${curve}:${sigAlgo}:6`)!,
        },
      ],
    }),
    withSafetyMultiplier: (x: bigint) => (x * 3n) / 2n, // 1.5x
  };
});

mock.module("../src/features/protocol-parameters/service", () => ({
  getProtocolParameters: async (_net: string, _curveNum: number) => FAKE_PARAMS,
  warmupProtocolParameters: async () => ({ warmed: [], skipped: [] }),
}));

// Imports happen AFTER the mocks above so the routes wire to stubs.
const { healthRoutes } = await import("../src/features/health/routes");
const { networkRoutes } = await import("../src/features/network/routes");
const { pricingRoutes } = await import("../src/features/pricing/routes");
const { protocolParameterRoutes } = await import(
  "../src/features/protocol-parameters/routes"
);
const { metricsRoutes } = await import("../src/features/metrics/routes");
const { requestLogger } = await import("../src/http/middleware/request-logger");

function buildApp(opts: { withLogger?: boolean } = {}) {
  let app = new Elysia();
  if (opts.withLogger) app = app.use(requestLogger) as typeof app;
  return app
    .use(healthRoutes)
    .use(networkRoutes)
    .use(pricingRoutes)
    .use(protocolParameterRoutes)
    .use(metricsRoutes);
}

describe("read-only endpoints", () => {
  test("/v1/health returns ok shape", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/health", { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      uptime: number;
      now: string;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("mpckit");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.now).toBe("string");
  });

  test("/v1/network surfaces every enabled network + operator", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/network"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      operatorAddress: string;
      networks: Array<{
        network: string;
        packages: { ikaPackage: string; ikaDwallet2pcMpcPackage: string };
        objects: { coordinator: string; system: string };
        latestEncryptionKey: { id: string; epoch: number; loadedAt: number };
      }>;
    };
    expect(body.networks).toHaveLength(1);
    const net = body.networks[0]!;
    expect(net.network).toBe("testnet");
    expect(net.packages.ikaPackage).toBe("0xPKG_IKA");
    expect(net.objects.coordinator).toBe("0xCOORD");
    expect(net.latestEncryptionKey.id).toBe("0xKEY");
    expect(net.latestEncryptionKey.epoch).toBe(42);
    expect(typeof body.operatorAddress).toBe("string");
    expect(body.operatorAddress).toMatch(/^0x[0-9a-f]+$/);
  });

  test("/v1/pricing serializes bigints + key strings", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/v1/pricing"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{
        keyString: string;
        value: { feeIka: string; gasFeeReimbursementSui: string };
      }>;
    };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]!.keyString).toBe("0:0:5");
    expect(body.entries[0]!.value.feeIka).toBe("100");
    expect(body.entries[1]!.value.gasFeeReimbursementSuiForSystemCalls).toBe(
      "75",
    );
  });

  test("/v1/pricing/quote/sign applies safety multiplier", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/pricing/quote/sign?curve=0&sigAlgo=0"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      curve: number;
      signatureAlgorithm: number;
      raw: { feeIka: string; feeSui: string };
      quoted: {
        feeIka: string;
        feeSui: string;
        safetyMultiplier: number;
      };
      protocols: Array<{ protocol: number; name: string }>;
    };
    expect(body.curve).toBe(0);
    expect(body.raw.feeIka).toBe("400");
    expect(body.raw.feeSui).toBe("725");
    // Safety multiplier mock = 1.5x.
    expect(body.quoted.feeIka).toBe("600");
    expect(body.quoted.feeSui).toBe("1087");
    expect(body.protocols.map((p) => p.name)).toEqual(["Presign", "Sign"]);
  });

  test("/v1/pricing/quote/sign rejects missing query params", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/pricing/quote/sign?curve=0"),
    );
    expect(res.status).toBe(422);
  });

  test("/v1/protocol-parameters base64-encodes bytes", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/v1/protocol-parameters?curve=0"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      curve: string;
      encryptionKeyId: string;
      bytesBase64: string;
      bytesLength: number;
    };
    expect(body.curve).toBe("SECP256K1");
    expect(body.encryptionKeyId).toBe("0xKEY");
    expect(body.bytesLength).toBe(4);
    // 0xdeadbeef -> base64 = "3q2+7w=="
    expect(body.bytesBase64).toBe("3q2+7w==");
  });

  test("/metrics serves prometheus text", async () => {
    const app = buildApp();
    const res = await app.handle(new Request("http://localhost/metrics"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("mpckit_");
  });
});

describe("request logger", () => {
  test("echoes inbound x-request-id header", async () => {
    const app = buildApp({ withLogger: true });
    const res = await app.handle(
      new Request("http://localhost/v1/health", {
        headers: { "x-request-id": "trace-abc" },
      }),
    );
    expect(res.headers.get("x-request-id")).toBe("trace-abc");
  });

  test("mints a request id when absent", async () => {
    const app = buildApp({ withLogger: true });
    const res = await app.handle(new Request("http://localhost/v1/health"));
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    // crypto.randomUUID format: 8-4-4-4-12.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("ignores absurdly long inbound id", async () => {
    const app = buildApp({ withLogger: true });
    const res = await app.handle(
      new Request("http://localhost/v1/health", {
        headers: { "x-request-id": "x".repeat(500) },
      }),
    );
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("resilience layer", () => {
  type ResilienceModule = typeof import("../src/shared/sui/resilience");
  let callResilient: ResilienceModule["callResilient"];
  let _resetBreakersForTest: ResilienceModule["_resetBreakersForTest"];

  beforeEach(async () => {
    const mod = await import("../src/shared/sui/resilience");
    callResilient = mod.callResilient;
    _resetBreakersForTest = mod._resetBreakersForTest;
    _resetBreakersForTest();
  });

  afterEach(() => {
    _resetBreakersForTest();
  });

  test("retries transient failures and resolves", async () => {
    let calls = 0;
    const result = await callResilient(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient: connection reset");
        return "ok";
      },
      { name: "test-transient", retries: 5 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("does not retry permanent gRPC client errors", async () => {
    let calls = 0;
    await expect(
      callResilient(
        async () => {
          calls += 1;
          const err = new Error("bad input") as Error & { code: string };
          err.code = "INVALID_ARGUMENT";
          throw err;
        },
        { name: "test-permanent", retries: 5 },
      ),
    ).rejects.toThrow(/bad input/);
    expect(calls).toBe(1);
  });

  test("opens the circuit after persistent failures", async () => {
    const tuning = {
      timeoutMs: 1_000,
      errorThresholdPercentage: 50,
      resetTimeoutMs: 60_000,
      volumeThreshold: 3,
    };
    let calls = 0;
    const fire = () =>
      callResilient(
        async () => {
          calls += 1;
          throw new Error("upstream down");
        },
        { name: "test-breaker", retries: 0, tuning },
      ).catch((e: unknown) => e);

    // Drive failures serially so the rolling window observes each result
    // before the next call. Once volume + error% cross the thresholds the
    // breaker opens and subsequent fires are short-circuited.
    let opened = false;
    let callsAtOpen = 0;
    for (let i = 0; i < 12; i += 1) {
      const e = (await fire()) as { code?: string; message?: string };
      if (e?.code === "EOPENBREAKER" || /breaker/i.test(e?.message ?? "")) {
        opened = true;
        callsAtOpen = calls;
        break;
      }
    }
    expect(opened).toBe(true);
    // After the breaker opens, the next fire should NOT invoke the function.
    const before = calls;
    await fire();
    expect(calls).toBe(before);
    expect(callsAtOpen).toBeGreaterThanOrEqual(3);
  });
});
