import { env } from "@/config/env";
import { log } from "@/config/log";
/**
 * Single shared ioredis client. All callers (rate limit, distributed
 * locks, idempotency cache, pg-boss is a separate connection) reuse
 * the same instance; lazy-init on first use.
 *
 * Returns `null` when `REDIS_URL` is unset so callers can fall back
 * to a degraded path without crashing.
 */
import IORedis, { type Redis } from "ioredis";

let _redis: Redis | undefined;
let _initFailed = false;

export function getRedis(): Redis | null {
  if (_initFailed) return null;
  if (_redis) return _redis;
  if (!env.REDIS_URL) return null;
  try {
    _redis = new IORedis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableAutoPipelining: true,
    });
    _redis.on("error", (err) => {
      log.warn({ err: err.message }, "redis error");
    });
    return _redis;
  } catch (err) {
    log.error({ err }, "redis init failed");
    _initFailed = true;
    return null;
  }
}

export function _resetRedisForTest(): void {
  _redis = undefined;
  _initFailed = false;
}
