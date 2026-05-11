/**
 * Network metadata service: latest network encryption key id + epoch,
 * one entry per enabled chain network.
 *
 * Exposed to clients via /v1/network. Refreshed via mutable LRU cache
 * with stale-while-revalidate. Reconfiguration events from Sui can be
 * wired in Phase 5+ to invalidate eagerly; for now the soft TTL is
 * sufficient.
 */
import type { IkaNetwork } from "@/config/env";
import { mutableCache } from "@/shared/cache/l0";
import { getIkaClient } from "@/shared/ika/client";

export interface NetworkInfo {
  encryptionKeyId: string;
  epoch: string | number;
  loadedAt: number;
}

const FAMILY = "network";

async function loadLatest(network: IkaNetwork): Promise<NetworkInfo> {
  const ika = await getIkaClient(network);
  const k = await ika.getLatestNetworkEncryptionKey();
  return {
    encryptionKeyId: k.id,
    epoch: (k as { epoch?: string | number }).epoch ?? "unknown",
    loadedAt: Date.now(),
  };
}

const cache = mutableCache<NetworkInfo>({
  family: FAMILY,
  ttlMs: 60 * 60 * 1000, // 1h soft TTL; will be invalidated by events later
  fetcher: (key: string) => loadLatest(key as IkaNetwork),
  max: 4,
});

export async function getNetworkInfo(
  network: IkaNetwork,
): Promise<NetworkInfo> {
  const v = await cache.fetch(network);
  if (!v) throw new Error("network: failed to load latest encryption key");
  return v;
}
