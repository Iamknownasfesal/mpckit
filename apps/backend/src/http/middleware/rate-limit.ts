/**
 * Token-bucket rate limiter backed by `rate-limiter-flexible`.
 *
 * Two buckets: authenticated principals get 60/min, anonymous gets
 * 30/2min. RLF runs the increment-and-check inside Redis (atomic across
 * pods) and falls back to an in-memory `insuranceLimiter` when Redis
 * is unreachable, so the API stays serving instead of 429'ing every
 * caller during a cache outage. If neither store is configured (DB-less
 * mode), the middleware no-ops.
 */
import { Elysia } from "elysia";
import IORedis, { type Redis } from "ioredis";
import {
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterRes,
} from "rate-limiter-flexible";
import { env } from "@/config/env";
import { log } from "@/config/log";
import { AuthError, principalFor } from "@/http/middleware/auth";
import { loggerFor } from "@/http/middleware/request-logger";

const AUTHED_POINTS = 60;
const AUTHED_DURATION_SEC = 60;
const ANON_POINTS = 30;
const ANON_DURATION_SEC = 120;

let redis: Redis | undefined;
let authedLimiter: RateLimiterRedis | RateLimiterMemory | undefined;
let anonLimiter: RateLimiterRedis | RateLimiterMemory | undefined;

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (redis) return redis;
  redis = new IORedis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableAutoPipelining: true,
  });
  redis.on("error", (err) => {
    log.warn({ err: err.message }, "redis error");
  });
  return redis;
}

function buildLimiters() {
  if (authedLimiter && anonLimiter) {
    return { authed: authedLimiter, anon: anonLimiter };
  }
  const r = getRedis();
  if (r) {
    // RLF's `insuranceLimiter` kicks in only when Redis is down — same
    // fall-open philosophy as before, but cleaner: instead of letting
    // every request through, we keep enforcing limits in memory per
    // pod until Redis recovers.
    authedLimiter = new RateLimiterRedis({
      storeClient: r,
      keyPrefix: "mpckit:rl:authed",
      points: AUTHED_POINTS,
      duration: AUTHED_DURATION_SEC,
      insuranceLimiter: new RateLimiterMemory({
        points: AUTHED_POINTS,
        duration: AUTHED_DURATION_SEC,
      }),
    });
    anonLimiter = new RateLimiterRedis({
      storeClient: r,
      keyPrefix: "mpckit:rl:anon",
      points: ANON_POINTS,
      duration: ANON_DURATION_SEC,
      insuranceLimiter: new RateLimiterMemory({
        points: ANON_POINTS,
        duration: ANON_DURATION_SEC,
      }),
    });
  } else {
    // No Redis configured (DB-less dev mode). Memory-only is fine here
    // since there's only one pod.
    authedLimiter = new RateLimiterMemory({
      points: AUTHED_POINTS,
      duration: AUTHED_DURATION_SEC,
    });
    anonLimiter = new RateLimiterMemory({
      points: ANON_POINTS,
      duration: ANON_DURATION_SEC,
    });
  }
  return { authed: authedLimiter, anon: anonLimiter };
}

function isRateLimiterRes(v: unknown): v is RateLimiterRes {
  return typeof v === "object" && v !== null && "msBeforeNext" in v;
}

/**
 * Skipped paths: /v1/health, /metrics — operators rely on these for
 * liveness probing. Public read endpoints (network, pricing, etc.)
 * still get rate-limited by IP since they're cheap to abuse.
 */
const SKIP_PATHS = new Set(["/v1/health", "/metrics"]);

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function pathOf(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "/";
  }
}

export const rateLimitMiddleware = new Elysia({ name: "rate-limit" }).onRequest(
  async ({ request, set }) => {
    const path = pathOf(request);
    if (SKIP_PATHS.has(path)) return;

    const principal = principalFor(request);
    const { authed, anon } = buildLimiters();
    const limiter = principal ? authed : anon;
    const key = principal
      ? principal.apiKey
        ? `key:${principal.apiKey.id}`
        : `user:${principal.user.id}`
      : `ip:${clientIp(request)}`;

    try {
      const res = await limiter.consume(key, 1);
      set.headers["x-ratelimit-limit"] = String(
        principal ? AUTHED_POINTS : ANON_POINTS,
      );
      set.headers["x-ratelimit-remaining"] = String(res.remainingPoints);
    } catch (err) {
      // RLF rejects with a RateLimiterRes when the bucket is empty.
      // Anything else (an internal error from the store layer with no
      // insurance fallback wired up) we treat as fail-open + log.
      if (!isRateLimiterRes(err)) {
        log.warn({ err }, "rate-limit unexpected error; allowing request");
        return;
      }
      const retrySec = Math.max(1, Math.ceil(err.msBeforeNext / 1000));
      set.headers["retry-after"] = String(retrySec);
      set.headers["x-ratelimit-limit"] = String(
        principal ? AUTHED_POINTS : ANON_POINTS,
      );
      set.headers["x-ratelimit-remaining"] = "0";
      loggerFor(request).warn({ key, retrySec }, "rate limit exceeded");
      throw new AuthError(
        // 429 isn't an auth error per se, but reusing the class keeps
        // the onError path uniform.
        429 as unknown as 401,
        "rate limit exceeded",
        "RATE_LIMITED",
      );
    }
  },
);

export async function closeRedis(): Promise<void> {
  authedLimiter = undefined;
  anonLimiter = undefined;
  if (redis) {
    await redis.quit().catch(() => {});
    redis = undefined;
  }
}
