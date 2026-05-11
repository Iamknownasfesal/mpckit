/**
 * Distributed lock over Redis. Standard `SET NX PX` + token-protected
 * Lua DEL: only the holder can release; if a holder dies the TTL
 * releases the lock automatically.
 *
 * `withLock(key, fn, opts)` is the canonical entry point: acquire,
 * run `fn`, release. If Redis isn't configured, falls back to a
 * single-process FIFO queue keyed by lock name (good enough for dev).
 */
import { randomUUID } from "node:crypto";
import { log } from "@/config/log";
import { getRedis } from "@/shared/redis/client";

export interface LockOptions {
  /** How long the lock can be held before TTL kicks in. */
  ttlMs?: number;
  /** Total time to wait acquiring before giving up. */
  acquireTimeoutMs?: number;
  /** Poll interval while waiting. */
  retryEveryMs?: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_EVERY_MS = 100;

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const retryEveryMs = opts.retryEveryMs ?? DEFAULT_RETRY_EVERY_MS;

  const token = randomUUID();
  const acquired = await acquire(
    key,
    token,
    ttlMs,
    acquireTimeoutMs,
    retryEveryMs,
  );
  if (!acquired) {
    throw new Error(
      `lock: failed to acquire ${key} within ${acquireTimeoutMs}ms`,
    );
  }
  try {
    return await fn();
  } finally {
    await release(key, token);
  }
}

async function acquire(
  key: string,
  token: string,
  ttlMs: number,
  acquireTimeoutMs: number,
  retryEveryMs: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return inProcessQueue.acquire(key);
  }
  const deadline = Date.now() + acquireTimeoutMs;
  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, "PX", ttlMs, "NX");
    if (ok === "OK") return true;
    await sleep(retryEveryMs);
  }
  return false;
}

const RELEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
`;

async function release(key: string, token: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    inProcessQueue.release(key);
    return;
  }
  try {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
  } catch (err) {
    log.warn({ err, key }, "lock release failed (TTL will reclaim)");
  }
}

const inProcessQueue = (() => {
  const waiters = new Map<string, Array<() => void>>();
  const held = new Set<string>();
  return {
    async acquire(key: string): Promise<boolean> {
      if (!held.has(key)) {
        held.add(key);
        return true;
      }
      return new Promise<boolean>((resolve) => {
        const q = waiters.get(key) ?? [];
        q.push(() => resolve(true));
        waiters.set(key, q);
      });
    },
    release(key: string): void {
      const q = waiters.get(key);
      const next = q?.shift();
      if (next) next();
      else held.delete(key);
    },
  };
})();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
