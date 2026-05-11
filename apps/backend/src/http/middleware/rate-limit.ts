import { env } from "@/config/env";
import { log } from "@/config/log";
import { AuthError, principalFor } from "@/http/middleware/auth";
import { loggerFor } from "@/http/middleware/request-logger";
import { Elysia } from "elysia";
/**
 * Redis token-bucket rate limiter.
 *
 * Per authenticated key (or per-IP for anonymous), we maintain a bucket
 * with `capacity` tokens that refills at `refillPerSec`. Each request
 * consumes one token. A request that finds the bucket empty is
 * rejected with 429 + Retry-After.
 *
 * The increment-and-check is done in a single Lua script so concurrent
 * workers can't race past the limit. Falls back to permissive behavior
 * (no limit) when Redis isn't configured or the script errors — we'd
 * rather let traffic through than DoS our own service when the cache
 * misbehaves.
 */
import IORedis, { type Redis } from "ioredis";

const DEFAULT_CAPACITY = 60; // tokens per window
const DEFAULT_REFILL_PER_SEC = 1; // 60 / 60s window
const ANON_CAPACITY = 30;
const ANON_REFILL_PER_SEC = 0.5;

let redis: Redis | undefined;
let scriptSha: string | undefined;

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (redis) return redis;
  redis = new IORedis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableAutoPipelining: true,
  });
  redis.on("error", (err) => {
    // Don't spam: log once on disconnect, ioredis will reconnect.
    log.warn({ err: err.message }, "redis error");
  });
  return redis;
}

/**
 * Lua: refill the bucket up to `capacity`, try to consume `cost`,
 * return [allowed, tokens_remaining, retry_after_ms].
 *
 * Keys: bucket key.
 * Args: capacity, refill_per_sec, cost, now_ms.
 */
const SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, (now - ts) / 1000.0)
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil(((cost - tokens) / refill) * 1000)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
-- Bucket idle past 2x window = drop the row.
redis.call('PEXPIRE', key, math.ceil((capacity / refill) * 2 * 1000))

return { allowed, math.floor(tokens), retry }
`;

async function ensureScriptLoaded(r: Redis): Promise<string> {
  if (scriptSha) return scriptSha;
  scriptSha = (await r.script("LOAD", SCRIPT)) as string;
  return scriptSha;
}

interface BucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

async function tryConsume(
  bucketKey: string,
  capacity: number,
  refillPerSec: number,
): Promise<BucketResult> {
  const r = getRedis();
  if (!r) return { allowed: true, remaining: capacity, retryAfterMs: 0 };
  try {
    const sha = await ensureScriptLoaded(r);
    const res = (await r.evalsha(
      sha,
      1,
      bucketKey,
      String(capacity),
      String(refillPerSec),
      "1",
      String(Date.now()),
    )) as [number, number, number];
    return {
      allowed: res[0] === 1,
      remaining: res[1],
      retryAfterMs: res[2],
    };
  } catch (err) {
    // Most likely NOSCRIPT after a Redis flush; reload and try once.
    if ((err as { message?: string }).message?.includes("NOSCRIPT")) {
      scriptSha = undefined;
      try {
        return await tryConsume(bucketKey, capacity, refillPerSec);
      } catch {
        // fall through to permissive
      }
    }
    log.warn({ err }, "rate-limit script failed; allowing request");
    return { allowed: true, remaining: capacity, retryAfterMs: 0 };
  }
}

function bucketKeyFor(principalId: string): string {
  return `mpckit:rl:${principalId}`;
}

/**
 * Plugin: looks up the principal (set by authMiddleware on this same
 * request) and applies a per-key bucket. Falls back to per-IP for
 * anonymous requests on guarded routes.
 *
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
    let bucketId: string;
    let capacity: number;
    let refill: number;
    if (principal) {
      bucketId = principal.apiKey
        ? `key:${principal.apiKey.id}`
        : `user:${principal.user.id}`;
      capacity = DEFAULT_CAPACITY;
      refill = DEFAULT_REFILL_PER_SEC;
    } else {
      bucketId = `ip:${clientIp(request)}`;
      capacity = ANON_CAPACITY;
      refill = ANON_REFILL_PER_SEC;
    }

    const result = await tryConsume(bucketKeyFor(bucketId), capacity, refill);

    set.headers["x-ratelimit-limit"] = String(capacity);
    set.headers["x-ratelimit-remaining"] = String(result.remaining);

    if (!result.allowed) {
      const retrySec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      set.headers["retry-after"] = String(retrySec);
      loggerFor(request).warn({ bucketId, retrySec }, "rate limit exceeded");
      throw new AuthError(
        // 429 isn't an auth error per se, but reusing the class keeps
        // the onError path uniform. We'd extract a separate error type
        // when we have more non-401/403 thrown errors to share.
        429 as unknown as 401,
        "rate limit exceeded",
        "RATE_LIMITED",
      );
    }
  },
);

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = undefined;
    scriptSha = undefined;
  }
}
