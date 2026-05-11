import { type IkaNetwork, env } from "@/config/env";
import {
  assertPricesFresh,
  microUsdFromAtomic,
} from "@/features/pricing/price-feed";
import { errors } from "@/shared/errors";
import { getSuiClient } from "@/shared/sui/client";
/**
 * On-chain deposit verifier. Given a Sui tx digest and the user's
 * derived clearinghouse address, returns the net positive movement
 * to that address per accepted coin type, plus the on-chain sender.
 * Throws AppError on anything that isn't a clean credit (failed tx,
 * wrong recipient, unknown coin type).
 *
 * Pure read: never touches the DB. Caller persists the result inside
 * the same transaction that bumps `users.credits_micro` (microUSD).
 */
import { normalizeStructTag } from "@mysten/sui/utils";

export interface VerifiedDeposit {
  digest: string;
  sender: string;
  /** Per-coin-type sums credited to the user's address, atomic units. */
  amountsAtomic: Map<string, bigint>;
}

export async function verifyDeposit(
  network: IkaNetwork,
  digest: string,
  recipient: string,
): Promise<VerifiedDeposit> {
  const result = await getSuiClient(network).core.getTransaction({
    digest,
    include: { balanceChanges: true, effects: true, transaction: true },
  });
  if (result.$kind !== "Transaction") {
    throw errors.unprocessable(
      "deposit tx failed on chain",
      "DEPOSIT_TX_FAILED",
    );
  }
  const tx = result.Transaction;
  if (tx.status?.error) {
    throw errors.unprocessable(
      `deposit tx failed: ${tx.status.error}`,
      "DEPOSIT_TX_FAILED",
    );
  }
  const sender = tx.transaction?.sender ?? null;
  if (!sender) {
    throw errors.unprocessable("deposit tx has no sender", "DEPOSIT_BAD_SHAPE");
  }

  // gRPC returns coin types and addresses in fully expanded form (32-byte
  // hex). Env config typically uses short form ("0x2::sui::SUI"). Normalise
  // both sides so the set lookup actually matches.
  const accepted = new Set(
    env.BILLING_ACCEPTED_COIN_TYPES.map((t) => normalizeStructTag(t)),
  );
  const sums = new Map<string, bigint>();
  for (const change of tx.balanceChanges ?? []) {
    if (change.address !== recipient) continue;
    const ct = normalizeStructTag(change.coinType);
    if (!accepted.has(ct)) continue;
    const amount = BigInt(change.amount);
    if (amount <= 0n) continue;
    sums.set(ct, (sums.get(ct) ?? 0n) + amount);
  }
  if (sums.size === 0) {
    throw errors.unprocessable(
      "no accepted coin transferred to deposit address",
      "DEPOSIT_NO_CREDIT",
    );
  }
  return { digest, sender, amountsAtomic: sums };
}

export function creditsFor(
  coinType: string,
  amountAtomic: bigint,
): {
  /** microUSD credited (1 microUSD = $0.000001). */
  credits: bigint;
  /** microUSD per 1 whole coin used for this conversion (snapshot at call time). */
  rate: bigint;
} {
  // Refuse to bill against a stale snapshot: if CoinGecko hasn't been
  // reachable for longer than the configured budget, we'd be crediting
  // (or charging) the user at a price that has silently drifted.
  try {
    assertPricesFresh();
  } catch (err) {
    const code =
      (err as { code?: string }).code === "PRICE_FEED_STALE"
        ? "PRICE_FEED_STALE"
        : "PRICE_FEED_UNAVAILABLE";
    throw errors.unavailable(
      err instanceof Error ? err.message : String(err),
      code,
    );
  }
  try {
    const { microUsd, priceMicroUsd } = microUsdFromAtomic(
      coinType,
      amountAtomic,
    );
    return { credits: microUsd, rate: priceMicroUsd };
  } catch (err) {
    throw errors.internal(
      err instanceof Error ? err.message : String(err),
      "BILLING_RATE_MISSING",
    );
  }
}
