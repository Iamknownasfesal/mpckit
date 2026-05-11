/**
 * L1: per-object short-TTL cache for dwallet / presign / sign state
 * fetched from Sui. Same `lru-cache` backing as L0, just configured
 * with shorter TTLs and built per family.
 *
 * Sealing: when an object reaches a terminal state, we replace its
 * entry with `ttl=Infinity` so it lives until evicted by `max`.
 * Convenience wrapper provided.
 */
import { LRUCache } from "lru-cache";
import { cacheHits, cacheMisses } from "./metrics";

export interface L1Options<V extends {}> {
  family: string;
  /** Default ttl for non-terminal entries. */
  ttlMs?: number;
  /** Max entries. */
  max?: number;
  fetcher: (key: string) => Promise<V>;
}

export function l1Cache<V extends {}>(opts: L1Options<V>): L1Cache<V> {
  const inner = new LRUCache<string, V>({
    max: opts.max ?? 50_000,
    ttl: opts.ttlMs ?? 30_000,
    allowStale: false,
    fetchMethod: async (
      key: string,
      _stale: V | undefined,
      { signal }: { signal: AbortSignal },
    ): Promise<V> => {
      void signal;
      cacheMisses.inc({ tier: "l1", family: opts.family });
      return opts.fetcher(key);
    },
  });

  return new L1Cache<V>(inner, opts.family);
}

export class L1Cache<V extends {}> {
  constructor(
    private cache: LRUCache<string, V>,
    private family: string,
  ) {}

  async get(key: string): Promise<V | undefined> {
    const cached = this.cache.peek(key);
    if (cached !== undefined) {
      cacheHits.inc({ tier: "l1", family: this.family });
      return cached;
    }
    return this.cache.fetch(key);
  }

  /** Replace an entry with a sealed (ttl-disabled) one. */
  seal(key: string, value: V): void {
    this.cache.set(key, value, { ttl: 0 });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidatePrefix(prefix: string): number {
    let n = 0;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
        n += 1;
      }
    }
    return n;
  }

  size(): number {
    return this.cache.size;
  }
}
