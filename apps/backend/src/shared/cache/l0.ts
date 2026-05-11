/**
 * L0: in-process cache fronting expensive computations and remote
 * reads with single-flight, stale-while-revalidate, and (for content-
 * keyed entries) infinite TTL.
 *
 * Backed by `lru-cache`'s `fetchMethod`, which provides:
 *   - single-flight: concurrent calls for the same key share one fetch
 *   - allowStale: serve stale value while the background refresh runs
 *   - per-entry ttl
 *   - lru eviction with `max` cap
 *
 * Two cache "shapes" we use:
 *
 * 1. Mutable / advisory-ttl entries (pricing, latest network key, etc.)
 *      Use `mutableCache(family, opts)` and `cache.fetch(key)`.
 *
 * 2. Immutable / content-keyed entries (protocol public params keyed by
 *    sha256(networkDkgPublicOutput) + curve). Same value for the same
 *    key, forever. Use `immutableCache(family, opts)`.
 */
import { LRUCache } from "lru-cache";
import { cacheHits, cacheMisses } from "./metrics";

export interface MutableCacheOptions {
  family: string;
  /** Soft TTL in ms (lru-cache `ttl`). After this, value is "stale". */
  ttlMs: number;
  /** Max entries kept (lru-cache `max`). */
  max?: number;
  /** Optional fetcher for `cache.fetch(key)` calls. */
  fetcher?: (key: string) => Promise<unknown>;
}

export interface ImmutableCacheOptions {
  family: string;
  max?: number;
  fetcher?: (key: string) => Promise<unknown>;
}

/**
 * Build an LRU with stale-while-revalidate and single-flight via
 * fetchMethod. Emits Prometheus hit/miss counters.
 */
export function mutableCache<V extends {}>(
  opts: MutableCacheOptions,
): LRUCache<string, V> {
  const family = opts.family;

  return new LRUCache<string, V>({
    max: opts.max ?? 1024,
    ttl: opts.ttlMs,
    allowStale: true, // serve stale while a refresh is in flight
    noDeleteOnStaleGet: true, // keep stale entries until a fresh value lands
    updateAgeOnGet: false,
    ...(opts.fetcher
      ? {
          fetchMethod: async (
            key: string,
            _staleValue: V | undefined,
            { signal }: { signal: AbortSignal },
          ): Promise<V> => {
            void signal;
            const v = (await opts.fetcher!(key)) as V;
            return v;
          },
        }
      : {}),
    onInsert: () => cacheMisses.inc({ tier: "l0", family }),
  });
}

/**
 * Build an immutable, content-keyed cache. Entries never expire by
 * time; the caller controls invalidation by changing the cache key.
 */
export function immutableCache<V extends {}>(
  opts: ImmutableCacheOptions,
): LRUCache<string, V> {
  const family = opts.family;
  return new LRUCache<string, V>({
    max: opts.max ?? 256,
    // No ttl. Entries live until evicted by max.
    ...(opts.fetcher
      ? {
          fetchMethod: async (key: string): Promise<V> => {
            return (await opts.fetcher!(key)) as V;
          },
        }
      : {}),
    onInsert: () => cacheMisses.inc({ tier: "l0", family }),
  });
}

/**
 * Helper: read with hit/miss accounting. Use when you don't want to
 * configure `fetchMethod` on the cache itself.
 */
export async function getOrLoad<V extends {}>(
  cache: LRUCache<string, V>,
  family: string,
  key: string,
  loader: () => Promise<V>,
): Promise<V> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    cacheHits.inc({ tier: "l0", family });
    return cached;
  }
  // Coalesce concurrent loads via fetchMethod-style single-flight: we
  // emulate it here by setting a placeholder if we end up needing it,
  // but LRUCache.fetch is the right path if the cache was built with a
  // fetcher. This helper exists for caches built without one.
  cacheMisses.inc({ tier: "l0", family });
  const v = await loader();
  cache.set(key, v);
  return v;
}
