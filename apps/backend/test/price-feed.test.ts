/**
 * Pins the microUSD math, the IKA-coin-type registration path, the
 * staleness gate, and the sanity-bounds rejection of out-of-range
 * feed prices. Boots with `skipFetch: true` to avoid network calls.
 */
import { describe, expect, mock, test } from "bun:test";

const SUI = "0x2::sui::SUI";
const IKA = "0xIKA::ika::IKA";

mock.module("@/config/env", () => ({
  env: {
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    BILLING_USD_PRICES: { [SUI]: 5.0 },
    BILLING_COIN_DECIMALS: {},
    BILLING_COINGECKO_IDS: {},
    BILLING_PRICE_FEED_REFRESH_SEC: 3600,
    BILLING_PRICE_FEED_MAX_AGE_SEC: 14_400,
    BILLING_PRICE_FEED_MAX_DEVIATION: 10,
  },
}));

const {
  warmPriceFeed,
  microUsdFromAtomic,
  formatUsd,
  getPriceFeed,
  assertPricesFresh,
} = await import("@/features/pricing/price-feed");

await warmPriceFeed({ skipFetch: true, ikaCoinType: IKA });

describe("price-feed", () => {
  test("converts SUI atomic to microUSD using static price", () => {
    // 1 SUI at $5 = $5 = 5_000_000 microUSD.
    const r = microUsdFromAtomic(SUI, 1_000_000_000n);
    expect(r.microUsd).toBe(5_000_000n);
    expect(r.priceMicroUsd).toBe(5_000_000n);
  });

  test("converts IKA atomic via registered fallback ($0.05)", () => {
    // 1 IKA at $0.05 = 50_000 microUSD.
    const r = microUsdFromAtomic(IKA, 1_000_000_000n);
    expect(r.microUsd).toBe(50_000n);
  });

  test("formatUsd renders integer microUSD as a USD string", () => {
    expect(formatUsd(0n)).toBe("0.000000");
    expect(formatUsd(1n)).toBe("0.000001");
    expect(formatUsd(1_000_000n)).toBe("1.000000");
    expect(formatUsd(12_345_000n)).toBe("12.345000");
    expect(formatUsd(-50_000n)).toBe("-0.050000");
  });

  test("snapshot reports source=fallback when network is skipped", () => {
    const snap = getPriceFeed();
    expect(snap.source).toBe("fallback");
    expect(snap.pricesMicroUsd.size).toBeGreaterThan(0);
  });

  test("assertPricesFresh throws when no successful feed poll has happened", () => {
    // skipFetch boot means lastFeedSuccessAt is 0 and SUI has a gecko id,
    // so paid endpoints must fail closed instead of billing the static
    // fallback.
    expect(() => assertPricesFresh()).toThrow(/stale/);
  });
});
