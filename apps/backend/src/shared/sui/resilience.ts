/**
 * Resilience layer for Sui gRPC calls.
 *
 * Combines:
 *   - p-retry: jittered exponential backoff on transient failures
 *     (network blips, 5xx-equivalent gRPC statuses, fullnode lag).
 *   - opossum: per-endpoint circuit breaker. Once the validator is
 *     consistently failing, fail fast instead of hammering a degraded
 *     endpoint and stalling every request behind it.
 *
 * Each "operation name" gets its own breaker keyed by name, so a flaky
 * `simulateTransaction` doesn't trip reads of other endpoints. Latency
 * lands in the `mpckit_sui_rpc_latency_seconds` histogram regardless of
 * whether the call was retried, short-circuited, or successful.
 */
import CircuitBreaker from "opossum";
import pRetry, { type RetryContext } from "p-retry";
import { log } from "@/config/log";
import { suiRpcLatency } from "@/shared/cache/metrics";

const breakers = new Map<
  string,
  CircuitBreaker<[() => Promise<unknown>], unknown>
>();

interface BreakerTuning {
  /** Max time a single attempt can run before opossum aborts it. */
  timeoutMs: number;
  /** Open the breaker once error % crosses this in the rolling window. */
  errorThresholdPercentage: number;
  /** Cool-down before transitioning to half-open. */
  resetTimeoutMs: number;
  /** Minimum traffic in window before threshold is evaluated. */
  volumeThreshold: number;
}

const DEFAULT_TUNING: BreakerTuning = {
  timeoutMs: 15_000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 30_000,
  volumeThreshold: 5,
};

function getBreaker(name: string, tuning: BreakerTuning): CircuitBreaker {
  let b = breakers.get(name);
  if (b) return b;
  b = new CircuitBreaker(async (fn: () => Promise<unknown>) => fn(), {
    name,
    timeout: tuning.timeoutMs,
    errorThresholdPercentage: tuning.errorThresholdPercentage,
    resetTimeout: tuning.resetTimeoutMs,
    volumeThreshold: tuning.volumeThreshold,
    rollingCountTimeout: 10_000,
    rollingCountBuckets: 10,
  });
  b.on("open", () => log.warn({ breaker: name }, "circuit breaker opened"));
  b.on("halfOpen", () =>
    log.info({ breaker: name }, "circuit breaker half-open: probing"),
  );
  b.on("close", () =>
    log.info({ breaker: name }, "circuit breaker closed: traffic resumed"),
  );
  breakers.set(name, b);
  return b;
}

/**
 * Some gRPC failures should never be retried: validation errors,
 * permanently-rejected transactions, signature mismatches, missing
 * objects, etc. Treat anything carrying an `AbortError` marker or a
 * 4xx-equivalent payload as terminal.
 */
function isPermanent(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string | number; status?: string | number };
  // Breaker-open: bypass retries so we honor the cool-down.
  if (e.code === "EOPENBREAKER") return true;
  // gRPC status codes that map to client errors. Numeric or string form.
  const terminalCodes = new Set<string | number>([
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "PERMISSION_DENIED",
    "UNAUTHENTICATED",
    "FAILED_PRECONDITION",
    "OUT_OF_RANGE",
    "UNIMPLEMENTED",
    3,
    5,
    6,
    7,
    9,
    11,
    12,
    16,
  ]);
  if (e.code !== undefined && terminalCodes.has(e.code)) return true;
  if (e.status !== undefined && terminalCodes.has(e.status)) return true;
  return false;
}

export interface ResilientCallOptions {
  /** Logical operation name (e.g. "simulateTransaction"). Drives breaker grouping + metrics labels. */
  name: string;
  /** Service the gRPC call hits, for metrics. e.g. "execution", "state". */
  service?: string;
  /** Number of attempts beyond the first (default 3). */
  retries?: number;
  /** Per-call breaker tuning override. */
  tuning?: Partial<BreakerTuning>;
}

/**
 * Run `fn` through retry + breaker. Fails fast when the breaker is open;
 * retries transient failures with jittered exponential backoff; bypasses
 * retry for terminal client-side errors.
 */
export async function callResilient<T>(
  fn: () => Promise<T>,
  opts: ResilientCallOptions,
): Promise<T> {
  const tuning: BreakerTuning = { ...DEFAULT_TUNING, ...(opts.tuning ?? {}) };
  const breaker = getBreaker(opts.name, tuning);
  const service = opts.service ?? "sui";

  return pRetry(
    async () => {
      const start = process.hrtime.bigint();
      try {
        const result = (await breaker.fire(fn)) as T;
        const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
        suiRpcLatency.observe(
          { service, method: opts.name, status: "ok" },
          elapsed,
        );
        return result;
      } catch (err) {
        const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
        suiRpcLatency.observe(
          { service, method: opts.name, status: "error" },
          elapsed,
        );
        throw err;
      }
    },
    {
      retries: opts.retries ?? 3,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 2_000,
      randomize: true,
      shouldRetry: (ctx: RetryContext) => !isPermanent(ctx.error),
      onFailedAttempt: (ctx: RetryContext) => {
        log.warn(
          {
            op: opts.name,
            attempt: ctx.attemptNumber,
            retriesLeft: ctx.retriesLeft,
            err: ctx.error.message,
          },
          "sui rpc attempt failed",
        );
      },
    },
  );
}

/** Test-only: drop all breakers so each test starts with a closed circuit. */
export function _resetBreakersForTest(): void {
  for (const b of breakers.values()) b.shutdown();
  breakers.clear();
}
