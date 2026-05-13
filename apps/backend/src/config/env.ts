import { z } from "zod";

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  /**
   * Which role this process plays. `api` runs HTTP only, `worker`
   * runs pg-boss handlers only, `both` runs both (dev / single-pod).
   */
  PROCESS_TYPE: z.enum(["api", "worker", "both"]).default("api"),

  /**
   * Default network for anonymous endpoints that don't carry an
   * x-network header or principal. Must be one of the enabled networks
   * (a network is enabled by having all its MPCKITCORE_<NET>_* and
   * SUI_GAS_STATION_<NET>_* vars set). If unset, the first enabled
   * network (in preference order testnet, mainnet) is used.
   */
  IKA_DEFAULT_NETWORK: z.enum(["testnet", "mainnet"]).optional(),

  // Per-network Sui gRPC fullnode. Optional; defaults to the Mysten
  // public endpoint for that network.
  SUI_GRPC_URL_TESTNET: z.string().url().optional(),
  SUI_GRPC_URL_MAINNET: z.string().url().optional(),

  /**
   * Object ids of the deployed `mpckitcore` Move package, per network.
   * A network is enabled when its PACKAGE_ID is present; the other
   * three (OPERATOR_CAP, ADMIN_CAP, TREASURY) become required only for
   * the networks that are enabled. networks(env) does that validation.
   */
  MPCKITCORE_TESTNET_PACKAGE_ID: z.string().optional(),
  MPCKITCORE_MAINNET_PACKAGE_ID: z.string().optional(),
  MPCKITCORE_TESTNET_OPERATOR_CAP_ID: z.string().optional(),
  MPCKITCORE_MAINNET_OPERATOR_CAP_ID: z.string().optional(),
  MPCKITCORE_TESTNET_ADMIN_CAP_ID: z.string().optional(),
  MPCKITCORE_MAINNET_ADMIN_CAP_ID: z.string().optional(),
  MPCKITCORE_TESTNET_TREASURY_ID: z.string().optional(),
  MPCKITCORE_MAINNET_TREASURY_ID: z.string().optional(),

  /**
   * Self-host opt-in: when true, expose the shared-dWallet DKG path.
   * Default false. Hosted MPCKit is non-custodial; only operators who
   * explicitly take custodial responsibility should turn this on.
   */
  ALLOW_SHARED_DWALLETS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // ── Hot wallet ─────────────────────────────────────────────────────
  /**
   * Where the operator's 32-byte Ed25519 seed comes from:
   *
   *   `env`     read `HOT_WALLET_SUI_SECRET_HEX` directly. Dev only —
   *             anyone with read access to env or container image
   *             owns the key.
   *   `aws-kms` decrypt `HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64`
   *             via AWS KMS at boot (envelope encryption). Plaintext
   *             never leaves process memory.
   */
  HOT_WALLET_PROVIDER: z.enum(["env", "aws-kms"]).default("env"),
  /** Hex Ed25519 seed; required when HOT_WALLET_PROVIDER=env. */
  HOT_WALLET_SUI_SECRET_HEX: z.string().optional(),
  /** Base64 KMS ciphertext blob; required when HOT_WALLET_PROVIDER=aws-kms. */
  HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64: z.string().optional(),
  /** Optional KMS key id/ARN — pinned for ciphertext-substitution defence. */
  HOT_WALLET_KMS_KEY_ID: z.string().optional(),
  /** AWS region for the KMS client; falls back to AWS_REGION when unset. */
  HOT_WALLET_KMS_REGION: z.string().optional(),

  /**
   * sui-gas-pool daemon, per network. The daemon is bound to one
   * fullnode (one Sui network) per process, so each enabled chain
   * needs its own SUI_GAS_STATION_<NET>_URL + _AUTH pair. Validated
   * lazily by networks(env) — networks without a gas station block
   * stay disabled.
   */
  SUI_GAS_STATION_TESTNET_URL: z.string().url().optional(),
  SUI_GAS_STATION_TESTNET_AUTH: z.string().min(1).optional(),
  SUI_GAS_STATION_MAINNET_URL: z.string().url().optional(),
  SUI_GAS_STATION_MAINNET_AUTH: z.string().min(1).optional(),
  /**
   * Gas budget reserved per PTB from the pool, in mist. The pool refunds
   * unused gas, so we keep this generous (default 0.5 SUI) — every Move
   * call we issue measured under 0.2 SUI in the per-step bench. Raise
   * if a heavier PTB type is added.
   */
  SUI_GAS_STATION_BUDGET_MIST: z.coerce
    .bigint()
    .positive()
    .default(500_000_000n),
  /**
   * Reservation TTL passed to /v1/reserve_gas. Backend has to build +
   * sign + submit within this window or the pool reclaims the coin.
   * 30s is comfortable for our worst PTB build path (DKG ~150ms build
   * + sign).
   */
  SUI_GAS_STATION_RESERVE_SECS: z.coerce.number().int().positive().default(30),

  // L2 + L3.
  REDIS_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),

  /**
   * Per-bucket presign pool target sizes. Worker tops up when the
   * count of `ready` rows for a `(curve, sigAlgo)` bucket falls
   * below `low`, refilling up to `high`. Per-bucket overrides aren't
   * supported yet; one global low/high pair.
   */
  PRESIGN_POOL_LOW_WATER: z.coerce.number().int().positive().default(20),
  PRESIGN_POOL_HIGH_WATER: z.coerce.number().int().positive().default(100),
  /**
   * How long an `allocated` row is allowed to sit before the sweep
   * rolls it back to `ready` (assumes the worker died holding it).
   */
  PRESIGN_RESERVATION_TTL_SEC: z.coerce.number().int().positive().default(300),
  /**
   * Maximum size of a single `request_global_presign` PTB. Larger
   * batches amortise gas; too-large batches slow down warm-up.
   */
  PRESIGN_BATCH_SIZE: z.coerce.number().int().positive().default(10),

  // Pricing safety multiplier baked into quote responses.
  PRICING_SAFETY_MULTIPLIER: z.coerce.number().positive().default(1.5),

  // ── Off-chain credits billing ───────────────────────────────────────
  /**
   * 32-byte hex secret used to derive a per-user deposit Sui keypair
   * via HKDF(seed, userId). The backend re-derives the keypair on
   * demand (sweep), so per-user secrets are never persisted. Rotating
   * this seed orphans every user's existing address — treat as
   * a long-lived secret.
   */
  BILLING_DEPOSIT_MASTER_SEED_HEX: z.string().optional(),
  /**
   * Sui address where the sweeper consolidates funds from per-user
   * deposit addresses. Distinct from the operator hot wallet because
   * accounting for billing revenue should be separable from operating
   * gas reserves.
   */
  BILLING_SWEEP_DESTINATION_ADDRESS: z.string().optional(),
  /**
   * Minimum total USD value (in microUSD) at a per-user deposit
   * address before the sweeper bothers building a PTB. Below this, the
   * sweep job reschedules instead of submitting. Default $0.10 — a
   * sweep PTB costs a few cents of gas, so we want to amortise.
   */
  BILLING_SWEEP_MIN_MICRO: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(100_000),
  /**
   * Allowed deposit coin types. Anything else lands in the deposit
   * with status=rejected. Defaults to native SUI only; add USDC by
   * setting both this and the matching rate.
   */
  BILLING_ACCEPTED_COIN_TYPES: z
    .string()
    .default("0x2::sui::SUI")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /**
   * USD prices for accepted coins (decimal). Used as the seed/fallback
   * for the live feed (price-feed.ts) and the source of truth for any
   * coin not on CoinGecko. Format:
   *   "0x2::sui::SUI=1.20,0x...::ika::IKA=0.05"
   */
  BILLING_USD_PRICES: z
    .string()
    .default("0x2::sui::SUI=1.0")
    .transform((v) => {
      const out: Record<string, number> = {};
      for (const pair of v.split(",")) {
        const [k, n] = pair.split("=");
        if (!k || !n) continue;
        const parsed = Number(n.trim());
        if (!Number.isFinite(parsed) || parsed <= 0) continue;
        out[k.trim()] = parsed;
      }
      return out;
    }),
  /**
   * Atomic decimals per coin. SUI defaults to 9; explicit entries
   * override the built-in. Format:
   *   "0x...::usdc::USDC=6"
   */
  BILLING_COIN_DECIMALS: z
    .string()
    .default("")
    .transform((v) => {
      const out: Record<string, number> = {};
      for (const pair of v.split(",")) {
        const [k, n] = pair.split("=");
        if (!k || !n) continue;
        const parsed = Number.parseInt(n.trim(), 10);
        if (!Number.isInteger(parsed) || parsed < 0) continue;
        out[k.trim()] = parsed;
      }
      return out;
    }),
  /**
   * CoinGecko ids for coins the feed should poll. Coins absent here
   * stay at their `BILLING_USD_PRICES` value. Format:
   *   "0x2::sui::SUI=sui"
   */
  BILLING_COINGECKO_IDS: z
    .string()
    .default("0x2::sui::SUI=sui")
    .transform((v) => {
      const out: Record<string, string> = {};
      for (const pair of v.split(",")) {
        const [k, n] = pair.split("=");
        if (!k || !n) continue;
        out[k.trim()] = n.trim();
      }
      return out;
    }),
  /** Hourly by default. Min 60s to avoid hammering the public feed. */
  BILLING_PRICE_FEED_REFRESH_SEC: z.coerce.number().int().min(60).default(3600),
  /**
   * Maximum age a successful CoinGecko poll can have before paid
   * endpoints (charge/quote/deposit) refuse to serve. Default 4h gives
   * 4 retry windows past the hourly refresh before we fail closed
   * rather than bill against a price snapshot that's silently drifted.
   */
  BILLING_PRICE_FEED_MAX_AGE_SEC: z.coerce
    .number()
    .int()
    .min(60)
    .default(14_400),
  /**
   * Reject feed prices that diverge from the operator-configured
   * static fallback by more than this multiplier (in either direction).
   * Default 10x: catches order-of-magnitude feed errors without
   * tripping on organic moves. Set higher for volatile assets where
   * 10x is reachable, but never disable — a CoinGecko hiccup that
   * returns $0.0001 for SUI would otherwise charge users 10000x less.
   * Coins without a static fallback skip this check.
   */
  BILLING_PRICE_FEED_MAX_DEVIATION: z.coerce.number().positive().default(10),
  /**
   * Op prices in microUSD. 1 microUSD = $0.000001. Defaults:
   *   sign            10_000  microUSD = $0.01
   *   dkg             50_000  microUSD = $0.05
   *   encryption-key   1_000  microUSD = $0.001
   */
  BILLING_PRICE_DKG_MICRO: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(50_000),
  BILLING_PRICE_SIGN_MICRO: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(10_000),
  BILLING_PRICE_ENCRYPTION_KEY_MICRO: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(1_000),
  /**
   * Per-deposit minimum in microUSD. Deposits below this are rejected
   * without crediting and never trigger a sweep, so an attacker can't
   * drain operator gas by spamming dust transfers. Default $1.
   */
  BILLING_MIN_DEPOSIT_MICRO: z.coerce
    .number()
    .int()
    .positive()
    .default(1_000_000),

  // Bootstrap admin key for first user issuance.
  ADMIN_API_KEY: z.string().optional(),

  // ── Dashboard auth (Better-Auth) ────────────────────────────────────
  /**
   * 32-byte random secret used to sign Better-Auth session cookies.
   * Required when the dashboard auth surface is enabled (boot logs a
   * warning if any other BETTER_AUTH_* var is set without this).
   */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /**
   * Public origin of the backend itself, e.g. https://api.mpckit.xyz.
   * Better-Auth uses this to build callback URLs and validate the
   * `Origin` header on cookie-bearing requests.
   */
  BETTER_AUTH_URL: z.string().url().optional(),
  /** Comma-separated list of dashboard origins allowed to send cookie credentials. */
  DASHBOARD_TRUSTED_ORIGINS: z
    .string()
    .default(
      "https://app.mpckit.xyz,https://app.testnet.mpckit.xyz,http://localhost:3011",
    )
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Observability.
  /** Hot-wallet SUI balance poll interval (seconds). */
  OBSERVABILITY_BALANCE_POLL_SEC: z.coerce.number().int().min(10).default(60),
  /**
   * OpenTelemetry OTLP/HTTP collector endpoint. When set, the API +
   * worker emit traces (HTTP, pg, ioredis, outgoing fetch) via the
   * `@opentelemetry/auto-instrumentations-node` package.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  /** Logical service name used as `service.name` on every span. */
  OTEL_SERVICE_NAME: z.string().default("mpckit"),
  /**
   * Sentry DSN. When set, uncaught errors + `loggerFor(request).error`
   * captures are forwarded for aggregation / alerting. Without it,
   * Sentry stays inert.
   */
  SENTRY_DSN: z.string().optional(),
  /** Fraction of traces forwarded to Sentry (0..1). */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  TELEMETRY_OPT_IN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export type IkaNetwork = "testnet" | "mainnet";
export const ALL_NETWORKS: readonly IkaNetwork[] = ["testnet", "mainnet"];

export interface NetworkEnv {
  network: IkaNetwork;
  suiGrpcUrl: string;
  packageId: string;
  operatorCapId: string;
  adminCapId: string;
  treasuryId: string;
  gasStationUrl: string;
  gasStationAuth: string;
}

const DEFAULT_SUI_GRPC_URLS: Record<IkaNetwork, string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};

/**
 * Build a per-network config block from env vars. Returns null when
 * the network is partially configured (warn-logged at boot) or fully
 * absent (silently disabled). A network is enabled when its
 * PACKAGE_ID + the four cap/treasury ids are set; the gas station
 * pair must also be present or signing PTBs would fail at first use.
 */
export function networkEnv(net: IkaNetwork): NetworkEnv | null {
  const upper = net.toUpperCase() as Uppercase<IkaNetwork>;
  const pkg = env[`MPCKITCORE_${upper}_PACKAGE_ID`];
  if (!pkg) return null;
  const opCap = env[`MPCKITCORE_${upper}_OPERATOR_CAP_ID`];
  const adminCap = env[`MPCKITCORE_${upper}_ADMIN_CAP_ID`];
  const treasury = env[`MPCKITCORE_${upper}_TREASURY_ID`];
  const gsUrl = env[`SUI_GAS_STATION_${upper}_URL`];
  const gsAuth = env[`SUI_GAS_STATION_${upper}_AUTH`];
  if (!opCap || !adminCap || !treasury || !gsUrl || !gsAuth) {
    console.warn(
      `network ${net}: PACKAGE_ID set but missing one or more of OPERATOR_CAP_ID, ADMIN_CAP_ID, TREASURY_ID, GAS_STATION_URL, GAS_STATION_AUTH — disabling`,
    );
    return null;
  }
  const suiUrl =
    env[`SUI_GRPC_URL_${upper}` as const] ?? DEFAULT_SUI_GRPC_URLS[net];
  return {
    network: net,
    suiGrpcUrl: suiUrl,
    packageId: pkg,
    operatorCapId: opCap,
    adminCapId: adminCap,
    treasuryId: treasury,
    gasStationUrl: gsUrl.replace(/\/$/, ""),
    gasStationAuth: gsAuth,
  };
}

/** Enabled networks in deterministic order. */
export function enabledNetworks(): IkaNetwork[] {
  return ALL_NETWORKS.filter((n) => networkEnv(n) !== null);
}

/**
 * Default network for anonymous endpoints. Respects IKA_DEFAULT_NETWORK
 * if set and that network is enabled; otherwise the first enabled
 * network (testnet preferred).
 */
export function defaultNetwork(): IkaNetwork {
  const enabled = enabledNetworks();
  if (enabled.length === 0) {
    throw new Error(
      "no networks enabled: set MPCKITCORE_<NET>_PACKAGE_ID + caps + treasury + SUI_GAS_STATION_<NET>_URL/AUTH for at least one of testnet, mainnet",
    );
  }
  const pref = env.IKA_DEFAULT_NETWORK;
  if (pref && enabled.includes(pref)) return pref;
  return enabled[0]!;
}
