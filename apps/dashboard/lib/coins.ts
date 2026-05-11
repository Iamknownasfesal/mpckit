/**
 * Tiny coin-metadata helper. Maps Sui coin types to a friendly symbol
 * and a brand tint. Unknown coins fall back to the last `::` segment.
 */

type CoinMeta = {
  symbol: string;
  name: string;
  tint: string;
  decimals: number;
};

const KNOWN: Record<string, CoinMeta> = {
  "0x2::sui::SUI": {
    symbol: "SUI",
    name: "Sui",
    tint: "oklch(70% 0.16 240)",
    decimals: 9,
  },
  "0x2::usdc::USDC": {
    symbol: "USDC",
    name: "USD Coin",
    tint: "oklch(72% 0.14 260)",
    decimals: 6,
  },
  "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN":
    {
      symbol: "USDT",
      name: "Tether USD",
      tint: "oklch(70% 0.15 175)",
      decimals: 6,
    },
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC":
    {
      symbol: "USDC",
      name: "USD Coin",
      tint: "oklch(72% 0.14 260)",
      decimals: 6,
    },
  "0x2::ika::IKA": {
    symbol: "IKA",
    name: "Ika",
    tint: "oklch(78% 0.13 195)",
    decimals: 9,
  },
};

export function coinMeta(coinType: string): CoinMeta {
  const hit = KNOWN[coinType];
  if (hit) return hit;
  const symbol = coinType.split("::").pop() ?? "COIN";
  return {
    symbol,
    name: symbol,
    tint: "oklch(64% 0 0)",
    decimals: 9,
  };
}
