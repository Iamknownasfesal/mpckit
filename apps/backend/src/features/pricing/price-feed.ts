/**
 * USD price feed for accepted billing coins.
 *
 * Internal accounting unit is microUSD (1 USD = 1_000_000 microUSD).
 * This module owns the conversion from "atomic units of a coin" to
 * microUSD by combining:
 *
 *   - the coin's USD price (live from CoinGecko, refreshed hourly)
 *   - the coin's decimals (atomic units per 1 whole coin)
 *
 * Operator config:
 *
 *   BILLING_USD_PRICES    `coinType=usd_price` map. Used as the
 *                         seed/fallback when the live feed is down or
 *                         the coin isn't on CoinGecko (e.g. IKA pre-
 *                         listing). Format:
 *                         `0x2::sui::SUI=1.20,0x...::ika::IKA=0.05`
 *   BILLING_COIN_DECIMALS optional override; built-in default of 9 for
 *                         SUI is used when absent.
 *   BILLING_COINGECKO_IDS optional `coinType=coingecko_id` map for the
 *                         coins the feed should poll. Coins absent from
 *                         this map keep their static `BILLING_USD_PRICES`
 *                         value.
 *
 * Refresh:
 *   - boot: warmPriceFeed() seeds the cache before the API serves
 *     traffic; on failure it logs + falls back to the static map
 *   - background: a `setInterval` triggers a refresh every
 *     `BILLING_PRICE_FEED_REFRESH_SEC` seconds (default 3600)
 *
 * Conversion math:
 *   microUSD = atomic * priceMicroUsdPerCoin / 10^decimals
 *   priceMicroUsdPerCoin = round(usd_price * 1e6)
 *
 * Precision: integer microUSD. Sub-cent rounding is acceptable for a
 * sign that costs ~$0.01; the safety multiplier in pricing/service.ts
 * absorbs the bias.
 */

import { normalizeStructTag } from "@mysten/sui/utils";
import { env } from "@/config/env";
import { log } from "@/config/log";
import { priceFeedAgeSeconds, priceFeedStale } from "@/shared/cache/metrics";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3/simple/price";

// Built-in metadata for SUI and IKA. CoinGecko IDs are NOT hardcoded
// here: the operator's `BILLING_COINGECKO_IDS` is the source of truth
// so a static-only operator can opt out by emptying the env var.
// Only decimals + the fallback USD price are baked in.
const SUI_COIN_TYPE = "0x2::sui::SUI";
const SUI_DECIMALS = 9;
const IKA_DECIMALS = 9;
const IKA_FALLBACK_USD = 0.05;

export interface PriceFeedSnapshot {
  /** Normalized coin type -> microUSD per 1 whole coin (×1e6 of USD). */
  pricesMicroUsd: Map<string, bigint>;
  /** Wall-clock time when the snapshot was assembled (any source). */
  loadedAt: number;
  /** Wall-clock time of the most recent *successful* CoinGecko poll.
   *  0 means "never" (static-fallback boot). Used by `assertPricesFresh`. */
  lastFeedSuccessAt: number;
  /** "feed" if every poll-eligible coin came from CoinGecko this tick;
   *  "fallback" if no coins were poll-eligible or every poll failed;
   *  "mixed" if some coins came from the feed and others from static. */
  source: "feed" | "fallback" | "mixed";
}

interface CoinSpec {
  coinType: string;
  decimals: number;
  geckoId?: string;
  staticUsd?: number;
}

const registry = new Map<string, CoinSpec>();
let ikaCoinType: string | undefined;
let snapshot: PriceFeedSnapshot = {
  pricesMicroUsd: new Map(),
  loadedAt: 0,
  lastFeedSuccessAt: 0,
  source: "fallback",
};
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function normalize(coinType: string): string {
  return normalizeStructTag(coinType);
}

function register(spec: CoinSpec): void {
  registry.set(normalize(spec.coinType), {
    ...spec,
    coinType: normalize(spec.coinType),
  });
}

function buildRegistry(): void {
  registry.clear();
  // Built-in decimals + static fallback for SUI. The CoinGecko id comes
  // from env (default has it; operators can blank it to go static-only).
  register({ coinType: SUI_COIN_TYPE, decimals: SUI_DECIMALS, staticUsd: 1.0 });
  // IKA only registered when api.ts derives the network's coin type.
  if (ikaCoinType) {
    register({
      coinType: ikaCoinType,
      decimals: IKA_DECIMALS,
      staticUsd: IKA_FALLBACK_USD,
    });
  }
  // Env overrides + extras, in three passes so order doesn't matter.
  for (const [coinType, decimals] of Object.entries(
    env.BILLING_COIN_DECIMALS,
  )) {
    const ct = normalize(coinType);
    const prev = registry.get(ct);
    register({
      coinType: ct,
      decimals,
      geckoId: prev?.geckoId,
      staticUsd: prev?.staticUsd,
    });
  }
  for (const [coinType, geckoId] of Object.entries(env.BILLING_COINGECKO_IDS)) {
    const ct = normalize(coinType);
    const prev = registry.get(ct);
    register({
      coinType: ct,
      decimals: prev?.decimals ?? SUI_DECIMALS,
      geckoId,
      staticUsd: prev?.staticUsd,
    });
  }
  for (const [coinType, usd] of Object.entries(env.BILLING_USD_PRICES)) {
    const ct = normalize(coinType);
    const prev = registry.get(ct);
    register({
      coinType: ct,
      decimals: prev?.decimals ?? SUI_DECIMALS,
      geckoId: prev?.geckoId,
      staticUsd: usd,
    });
  }
}

function staticSnapshot(): PriceFeedSnapshot {
  const pricesMicroUsd = new Map<string, bigint>();
  for (const spec of registry.values()) {
    if (spec.staticUsd !== undefined) {
      pricesMicroUsd.set(spec.coinType, usdToMicroUsd(spec.staticUsd));
    }
  }
  return {
    pricesMicroUsd,
    loadedAt: Date.now(),
    lastFeedSuccessAt: snapshot.lastFeedSuccessAt,
    source: "fallback",
  };
}

function usdToMicroUsd(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export interface WarmPriceFeedOptions {
  /** IKA coin type for the deployed network (`<ikaPackage>::ika::IKA`). */
  ikaCoinType?: string;
  /** CoinGecko id for IKA. Defaults to "ika"; pass `null` to keep IKA
   *  static-only (e.g. ahead of listing). */
  ikaCoingeckoId?: string | null;
  /** Tests pass true to skip the network call + interval. */
  skipFetch?: boolean;
}

export async function warmPriceFeed(
  opts: WarmPriceFeedOptions = {},
): Promise<void> {
  if (opts.ikaCoinType) ikaCoinType = opts.ikaCoinType;
  buildRegistry();
  // Layer IKA's CoinGecko id on top of the env-derived registry. We
  // can't put this in env defaults because the IKA coin type is a
  // boot-time value that depends on the deployed package.
  if (ikaCoinType) {
    const ct = normalize(ikaCoinType);
    const spec = registry.get(ct);
    if (spec) {
      const wantedGeckoId =
        opts.ikaCoingeckoId === null
          ? undefined
          : (opts.ikaCoingeckoId ?? "ika");
      registry.set(ct, { ...spec, geckoId: wantedGeckoId });
    }
  }
  snapshot = staticSnapshot();
  if (opts.skipFetch) return;
  await refreshNow().catch((err) => {
    log.warn({ err }, "price-feed: initial fetch failed, using static rates");
  });
  if (!refreshTimer) {
    const ms = env.BILLING_PRICE_FEED_REFRESH_SEC * 1000;
    refreshTimer = setInterval(() => {
      refreshNow().catch((err) =>
        log.warn({ err }, "price-feed: scheduled refresh failed"),
      );
    }, ms);
    if (typeof refreshTimer.unref === "function") refreshTimer.unref();
  }
}

export function stopPriceFeed(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

export function getIkaCoinType(): string | undefined {
  return ikaCoinType;
}

async function refreshNow(): Promise<void> {
  const workList: { coinType: string; geckoId: string }[] = [];
  for (const spec of registry.values()) {
    if (spec.geckoId) {
      workList.push({ coinType: spec.coinType, geckoId: spec.geckoId });
    }
  }
  if (workList.length === 0) {
    snapshot = staticSnapshot();
    return;
  }

  const ids = [...new Set(workList.map((w) => w.geckoId))].join(",");
  const url = `${COINGECKO_BASE}?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `coingecko ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as Record<string, { usd?: number }>;

  // Seed with static fallbacks so any coin without a feed hit still has
  // a price in the resulting snapshot.
  const pricesMicroUsd = new Map<string, bigint>();
  for (const spec of registry.values()) {
    if (spec.staticUsd !== undefined) {
      pricesMicroUsd.set(spec.coinType, usdToMicroUsd(spec.staticUsd));
    }
  }
  let feedHits = 0;
  for (const { coinType, geckoId } of workList) {
    const usd = body[geckoId]?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      continue;
    }
    const spec = registry.get(coinType);
    if (spec?.staticUsd !== undefined) {
      const ratio = usd / spec.staticUsd;
      const max = env.BILLING_PRICE_FEED_MAX_DEVIATION;
      if (ratio > max || ratio < 1 / max) {
        log.warn(
          {
            coinType,
            geckoId,
            feedUsd: usd,
            staticUsd: spec.staticUsd,
            ratio,
            max,
          },
          "price-feed: rejecting out-of-bounds feed value; keeping prior",
        );
        continue;
      }
    }
    pricesMicroUsd.set(coinType, usdToMicroUsd(usd));
    feedHits++;
  }
  const source: PriceFeedSnapshot["source"] =
    feedHits === 0
      ? "fallback"
      : feedHits === workList.length
        ? "feed"
        : "mixed";
  snapshot = {
    pricesMicroUsd,
    loadedAt: Date.now(),
    lastFeedSuccessAt: feedHits > 0 ? Date.now() : snapshot.lastFeedSuccessAt,
    source,
  };
  refreshAgeGauge();
  log.info(
    { source, feedHits, polled: workList.length },
    "price-feed: refreshed",
  );
}

export function getPriceFeed(): PriceFeedSnapshot {
  return snapshot;
}

/**
 * Throws when prices are too stale to bill against. Paid endpoints
 * (charge, deposit, sign quote) call this before reading a price; read
 * endpoints surface staleness via the snapshot but don't block.
 *
 * Staleness here means "no successful CoinGecko poll within the
 * configured budget." A snapshot built only from static fallbacks is
 * always considered stale by this gate so the operator can't
 * accidentally serve real users at the seed rates indefinitely.
 */
export function assertPricesFresh(): void {
  const max = env.BILLING_PRICE_FEED_MAX_AGE_SEC * 1000;
  // Static-only operators (no CoinGecko ids configured) are an explicit
  // opt-in: skip the freshness check when there's nothing to poll.
  let polled = 0;
  for (const spec of registry.values()) if (spec.geckoId) polled++;
  if (polled === 0) return;

  const last = snapshot.lastFeedSuccessAt;
  const age = last === 0 ? Number.POSITIVE_INFINITY : Date.now() - last;
  if (age > max) {
    priceFeedStale.inc();
    const err: Error & { code?: string; ageSec?: number } = new Error(
      `price feed stale: last successful poll ${last === 0 ? "never" : `${Math.round(age / 1000)}s ago`} > max ${env.BILLING_PRICE_FEED_MAX_AGE_SEC}s`,
    );
    err.code = "PRICE_FEED_STALE";
    err.ageSec = last === 0 ? -1 : Math.round(age / 1000);
    throw err;
  }
}

/**
 * Refresh the `price_feed_age_seconds` gauge so a Prometheus scrape
 * reflects "now" instead of the last poll timestamp. Called from the
 * scrape handler and on every successful refresh.
 */
export function refreshAgeGauge(): void {
  const last = snapshot.lastFeedSuccessAt;
  const ageSec =
    last === 0 ? -1 : Math.max(0, Math.round((Date.now() - last) / 1000));
  priceFeedAgeSeconds.set(ageSec);
}

export function priceMicroUsdPerCoin(coinType: string): bigint | undefined {
  return snapshot.pricesMicroUsd.get(normalizeStructTag(coinType));
}

export function decimalsFor(coinType: string): number {
  const spec = registry.get(normalize(coinType));
  if (!spec) {
    throw new Error(
      `price-feed: ${coinType} not registered; add it to BILLING_USD_PRICES or BILLING_COIN_DECIMALS`,
    );
  }
  return spec.decimals;
}

/** atomic * microUsdPerCoin / 10^decimals. Integer microUSD. */
export function microUsdFromAtomic(
  coinType: string,
  amountAtomic: bigint,
): { microUsd: bigint; priceMicroUsd: bigint } {
  const priceMicroUsd = priceMicroUsdPerCoin(coinType);
  if (priceMicroUsd === undefined) {
    throw new Error(`price-feed: no USD price for ${coinType}`);
  }
  const decimals = decimalsFor(coinType);
  const denom = 10n ** BigInt(decimals);
  const microUsd = (amountAtomic * priceMicroUsd) / denom;
  return { microUsd, priceMicroUsd };
}

export function formatUsd(microUsd: bigint, decimals = 6): string {
  // Render integer microUSD as "X.YYYYYY" with up to `decimals` digits.
  const sign = microUsd < 0n ? "-" : "";
  const abs = microUsd < 0n ? -microUsd : microUsd;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  return `${sign}${whole}.${fracStr}`;
}
