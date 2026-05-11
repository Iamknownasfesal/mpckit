/**
 * Regression: gRPC's `getTransaction` returns coin types in fully
 * expanded form (`0x0000...0002::sui::SUI`), but env config typically
 * uses the short form (`0x2::sui::SUI`). Before normalisation, the
 * `accepted` set never matched and every deposit was rejected with
 * `DEPOSIT_NO_CREDIT`. This test pins both directions:
 *   - short env, long gRPC
 *   - long env, short gRPC (defensive — env can take either)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

const SHORT = "0x2::sui::SUI";
const LONG =
  "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const SENDER = "0xSENDER";
const RECIPIENT = "0xDEPOSIT_ADDRESS";

function fakeTxResponse(coinType: string, amountAtomic: string) {
  return {
    $kind: "Transaction" as const,
    Transaction: {
      digest: "FAKE_DIGEST",
      transaction: { sender: SENDER },
      balanceChanges: [
        { coinType, address: SENDER, amount: `-${amountAtomic}` },
        { coinType, address: RECIPIENT, amount: amountAtomic },
      ],
    },
  };
}

const fakeSuiClient = {
  core: {
    getTransaction: mock(() =>
      Promise.resolve(fakeTxResponse(LONG, "2000000000")),
    ),
  },
};

mock.module("@/shared/sui/client", () => ({
  getSuiClient: () => fakeSuiClient,
}));

mock.module("@/config/env", () => ({
  env: {
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
    BILLING_ACCEPTED_COIN_TYPES: [SHORT],
    // Static USD price: 1 SUI = $1, so 2 SUI atomic = $2 = 2_000_000 microUSD.
    BILLING_USD_PRICES: { [SHORT]: 1.0 },
    BILLING_COIN_DECIMALS: {},
    BILLING_COINGECKO_IDS: {},
    BILLING_PRICE_FEED_REFRESH_SEC: 3600,
  },
}));

const { verifyDeposit, creditsFor } = await import(
  "@/features/billing/verifier"
);
const { warmPriceFeed } = await import("@/features/pricing/price-feed");
// Seed the registry without triggering the network refresh.
await warmPriceFeed({ skipFetch: true });

describe("verifier coin-type normalisation", () => {
  beforeEach(() => {
    // Default response: long coin type from gRPC (production shape).
  });

  test("accepts long-form gRPC coin type when env uses short form", async () => {
    const got = await verifyDeposit("testnet", "DIGEST_OK", RECIPIENT);
    expect(got.sender).toBe(SENDER);
    // sums map keys are normalised to long form so downstream rate
    // lookups don't have to carry the original gRPC string.
    expect(got.amountsAtomic.size).toBe(1);
    expect([...got.amountsAtomic.values()][0]).toBe(2_000_000_000n);
  });

  test("rejects deposits to non-recipient addresses", async () => {
    await expect(
      verifyDeposit("testnet", "DIGEST_OK", "0xWRONG_ADDR"),
    ).rejects.toThrow(/no accepted coin/);
  });

  test("creditsFor accepts both short and long coin types", () => {
    // 2 SUI at $1/SUI = $2 = 2_000_000 microUSD.
    const fromShort = creditsFor(SHORT, 2_000_000_000n);
    const fromLong = creditsFor(LONG, 2_000_000_000n);
    expect(fromShort.credits).toBe(2_000_000n);
    expect(fromLong.credits).toBe(2_000_000n);
    expect(fromShort.rate).toBe(fromLong.rate);
    // rate = microUSD per 1 whole coin = $1 * 1e6 = 1_000_000.
    expect(fromShort.rate).toBe(1_000_000n);
  });
});
