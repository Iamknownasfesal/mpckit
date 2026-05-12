/**
 * Protocol public parameters service.
 *
 * Wraps `IkaClient.getProtocolPublicParameters`, which:
 *   - Reads the chunked Sui table-vec storing the network DKG public
 *     output bytes.
 *   - Calls `networkDkgPublicOutputToProtocolPublicParameters` (or the
 *     reconfiguration variant) via WASM.
 *
 * We cache the result by `(curve, networkEncryptionKeyId)`. The id
 * changes every network reconfiguration, so this is effectively a
 * content key for our purposes. WASM loads once on first call (boot
 * warmup); from then on, repeated requests for the same (curve, key id)
 * tuple hit our LRU and never re-touch WASM.
 *
 * If we ever need stricter content-keyed caching (e.g., to handle the
 * edge case where a reconfiguration produces identical bytes), we'd
 * replicate `readTableVecAsRawBytes` ourselves and hash the bytes.
 */
import { Curve } from "@ika.xyz/sdk";
import type { IkaNetwork } from "@/config/env";
import { immutableCache } from "@/shared/cache/l0";
import { wasmCalls } from "@/shared/cache/metrics";
import { getIkaClient } from "@/shared/ika/client";
import { listNetworks } from "@/shared/networks/registry";

const FAMILY = "protocol_params";

export interface ProtocolParamsEntry {
  /** Bytes consumed by the centralized-party WASM operations. */
  bytes: Uint8Array;
  /** Curve the params are for. */
  curve: Curve;
  /** Network encryption key id the params were derived from. */
  encryptionKeyId: string;
  /** Epoch the encryption key reported at load time. */
  epoch: number | string;
  loadedAt: number;
}

/** 0,1,2,3 -> Curve string enum value. Anything else throws. */
function curveFromNumber(n: number): Curve {
  switch (n) {
    case 0:
      return Curve.SECP256K1;
    case 1:
      return Curve.SECP256R1;
    case 2:
      return Curve.ED25519;
    case 3:
      return Curve.RISTRETTO;
    default:
      throw new Error(`unsupported curve number: ${n}`);
  }
}

function cacheKey(
  network: IkaNetwork,
  curve: Curve,
  encryptionKeyId: string,
): string {
  return `${network}:${curve}:${encryptionKeyId}`;
}

const cache = immutableCache<ProtocolParamsEntry>({
  family: FAMILY,
  max: 64,
});

/**
 * Get protocol params for `curve` against the latest network encryption
 * key. Cached by `(curve, encryptionKeyId)`, sealed forever per key id.
 */
export async function getProtocolParameters(
  network: IkaNetwork,
  curveNum: number,
): Promise<ProtocolParamsEntry> {
  const curve = curveFromNumber(curveNum);
  const ika = await getIkaClient(network);
  const netKey = await ika.getLatestNetworkEncryptionKey();
  const key = cacheKey(network, curve, netKey.id);

  const cached = cache.get(key);
  if (cached) return cached;

  wasmCalls.inc({ fn: "getProtocolPublicParameters" });
  const bytes = await ika.getProtocolPublicParameters(undefined, curve);

  const entry: ProtocolParamsEntry = {
    bytes: Uint8Array.from(bytes),
    curve,
    encryptionKeyId: netKey.id,
    epoch: netKey.epoch,
    loadedAt: Date.now(),
  };
  cache.set(key, entry);
  return entry;
}

/**
 * Boot warmup: pre-compute params for the listed curves so the first
 * user-facing request never pays WASM init. Tolerates missing curves.
 */
export async function warmupProtocolParameters(curves: number[]): Promise<{
  warmed: Array<{ network: IkaNetwork; curve: number }>;
  skipped: Array<{ network: IkaNetwork; curve: number; reason: string }>;
}> {
  const warmed: Array<{ network: IkaNetwork; curve: number }> = [];
  const skipped: Array<{ network: IkaNetwork; curve: number; reason: string }> =
    [];
  for (const network of listNetworks()) {
    for (const c of curves) {
      try {
        await getProtocolParameters(network, c);
        warmed.push({ network, curve: c });
      } catch (err) {
        skipped.push({
          network,
          curve: c,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return { warmed, skipped };
}
