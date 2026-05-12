/**
 * Prometheus metrics. Single registry for the whole process; exported
 * by the /metrics route.
 */
import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "mpckit_" });

export const cacheHits = new Counter({
  name: "mpckit_cache_hits_total",
  help: "Cache hits, labeled by tier and key family.",
  labelNames: ["tier", "family"] as const,
  registers: [registry],
});

export const cacheMisses = new Counter({
  name: "mpckit_cache_misses_total",
  help: "Cache misses, labeled by tier and key family.",
  labelNames: ["tier", "family"] as const,
  registers: [registry],
});

export const wasmCalls = new Counter({
  name: "mpckit_wasm_calls_total",
  help: "WASM function invocations on the backend.",
  labelNames: ["fn"] as const,
  registers: [registry],
});

export const suiRpcLatency = new Histogram({
  name: "mpckit_sui_rpc_latency_seconds",
  help: "Sui gRPC call latency in seconds.",
  labelNames: ["service", "method", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpLatency = new Histogram({
  name: "mpckit_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ── Mainnet observability ────────────────────────────────────────────
//
// Operator-facing metrics. Each one is something an alert should fire
// on: a stale price feed under-bills users, an unknown sign-job state
// may leak a presign cap, an empty hot wallet stops accepting writes.

/** Incremented every time `assertPricesFresh()` rejects a paid call. */
export const priceFeedStale = new Counter({
  name: "mpckit_price_feed_stale_total",
  help: "Paid endpoint rejections because the USD price feed was past max-age.",
  registers: [registry],
});

/** Seconds since the last successful CoinGecko poll; updated on every
 *  scrape. Negative sentinel (-1) when the feed has never polled. */
export const priceFeedAgeSeconds = new Gauge({
  name: "mpckit_price_feed_age_seconds",
  help: "Seconds since the last successful CoinGecko poll. -1 means never.",
  registers: [registry],
});

/** Sign-job rollback safety: tx submitted to gas-pool but response was
 *  unreadable. Operator must reconcile via the digest from logs to
 *  decide whether to mark the cap consumed or refund the user. */
export const signSubmitUnknown = new Counter({
  name: "mpckit_sign_submit_unknown_total",
  help: "Sign jobs that hit an indeterminate executor failure (cap state unknown).",
  registers: [registry],
});

/** Operator hot wallet SUI balance in MIST, per Sui network. Updated
 *  every `OBSERVABILITY_BALANCE_POLL_SEC`. Page when this falls below
 *  your configured floor on either network. */
export const hotWalletSuiMist = new Gauge({
  name: "mpckit_hot_wallet_sui_mist",
  help: "Operator hot wallet SUI balance in MIST, labelled by network.",
  labelNames: ["network"] as const,
  registers: [registry],
});
