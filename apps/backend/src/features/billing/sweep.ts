/**
 * Drain a per-user deposit address into the main billing treasury via
 * a sponsored Sui transaction:
 *
 *   sender    = the user's HKDF-derived deposit keypair (we hold it)
 *   gasOwner  = the operator hot wallet (we hold it)
 *
 * The PTB enumerates every accepted coin type at the sender, merges
 * each type's coins into a single object, and transfers them all to
 * `BILLING_SWEEP_DESTINATION_ADDRESS`. Both keypairs sign the same
 * tx bytes; we submit both signatures together.
 *
 * Treasury receives the gross amount: gas comes off the operator's
 * SUI reserve, not the user's deposit. SUI and USDC sweep through the
 * same path; only the per-coin-type loop differs.
 *
 * Idempotent: if the address has nothing left to sweep we return
 * `{status: "empty"}`. Concurrent sweep jobs for the same user are
 * naturally guarded by the `singletonKey` set on enqueue + the fact
 * that whichever job arrives second will see an empty address.
 */
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag } from "@mysten/sui/utils";
import { eq } from "drizzle-orm";
import { env, type IkaNetwork } from "@/config/env";
import { log } from "@/config/log";
import { microUsdFromAtomic } from "@/features/pricing/price-feed";
import { deriveDepositKeypair } from "@/shared/billing/derive";
import { getDb } from "@/shared/db/client";
import { billingDeposits } from "@/shared/db/schema";
import { errors } from "@/shared/errors";
import { getSuiClient } from "@/shared/sui/client";
import { getHotWallet } from "@/shared/sui/hot-wallet";

export interface SweepResult {
  status: "swept" | "below-threshold" | "empty";
  digest?: string;
  /** Per-coin atomic sums credited to the destination, by coin type. */
  amountsAtomic?: Record<string, string>;
}

export async function sweepUserAddress(
  userId: string,
  network: IkaNetwork,
): Promise<SweepResult> {
  const dest = env.BILLING_SWEEP_DESTINATION_ADDRESS;
  if (!dest) throw errors.notConfigured("billing sweep destination");
  const minMicroUsd = BigInt(env.BILLING_SWEEP_MIN_MICRO);

  const sui = getSuiClient(network);
  const userKp = deriveDepositKeypair(userId, network);
  const sender = userKp.toSuiAddress();
  const operator = getHotWallet();
  const sponsor = operator.address();

  // Eligible balances at the sender. Sui gRPC returns coin types in
  // fully expanded 32-byte hex form ("0x000…002::sui::SUI"), while the
  // env config typically uses the short form. Normalise both sides so
  // a short-form env doesn't filter out every balance and silently
  // leave deposits stuck at the sender address.
  const balanceList = await sui.core.listBalances({ owner: sender });
  const accepted = new Set(
    env.BILLING_ACCEPTED_COIN_TYPES.map((t) => normalizeStructTag(t)),
  );
  const eligible = (balanceList.balances ?? []).filter(
    (b) =>
      accepted.has(normalizeStructTag(b.coinType)) && BigInt(b.balance) > 0n,
  );
  if (eligible.length === 0) return { status: "empty" };

  // Sum the USD value at the deposit address. We only skip when *every*
  // coin together still totals less than the operator-set USD floor —
  // this protects the operator from burning gas on dust without
  // hoarding non-SUI deposits whose price is on the feed.
  let totalMicroUsd = 0n;
  for (const b of eligible) {
    try {
      const { microUsd } = microUsdFromAtomic(b.coinType, BigInt(b.balance));
      totalMicroUsd += microUsd;
    } catch (err) {
      // Coin not on the feed: don't let an unpriced asset block the
      // sweep, but log so the operator notices and configures a price.
      log.warn(
        { userId, coinType: b.coinType, err: String(err) },
        "billing.sweep: coin missing from price feed; counting toward sweep anyway",
      );
      totalMicroUsd = -1n; // sentinel: force the sweep
      break;
    }
  }
  if (totalMicroUsd >= 0n && totalMicroUsd < minMicroUsd) {
    return { status: "below-threshold" };
  }

  const tx = new Transaction();
  tx.setSender(sender);
  tx.setGasOwner(sponsor);

  for (const bal of eligible) {
    const coins = await sui.core.listCoins({
      owner: sender,
      coinType: bal.coinType,
    });
    const objs = (coins.objects ?? []).map((c) => tx.object(c.objectId));
    if (objs.length === 0) continue;
    const head = objs[0];
    if (!head) continue;
    if (objs.length > 1) {
      tx.mergeCoins(head, objs.slice(1));
    }
    tx.transferObjects([head], dest);
  }

  const bytes = await tx.build({ client: sui });
  const userSig = (await userKp.signTransaction(bytes)).signature;
  const sponsorSig = (await operator.signTransaction(bytes)).signature;

  const result = await sui.core.executeTransaction({
    transaction: bytes,
    signatures: [userSig, sponsorSig],
    include: { effects: true, balanceChanges: true },
  });
  if (result.$kind !== "Transaction") {
    throw new Error(
      `sweep tx failed: ${JSON.stringify(result.FailedTransaction?.status)}`,
    );
  }
  const txn = result.Transaction;
  const credited: Record<string, bigint> = {};
  for (const c of txn.balanceChanges ?? []) {
    if (c.address !== dest) continue;
    credited[c.coinType] = (credited[c.coinType] ?? 0n) + BigInt(c.amount);
  }
  const amountsAtomic = Object.fromEntries(
    Object.entries(credited).map(([k, v]) => [k, v.toString()]),
  );
  log.info(
    { userId, sender, dest, digest: txn.digest, amountsAtomic },
    "billing.sweep: drained",
  );
  return { status: "swept", digest: txn.digest, amountsAtomic };
}

export async function markDepositSwept(
  depositId: string,
  sweepDigest: string,
): Promise<void> {
  await getDb()
    .update(billingDeposits)
    .set({
      sweepStatus: "swept",
      sweepTxDigest: sweepDigest,
      sweptAt: new Date(),
    })
    .where(eq(billingDeposits.id, depositId));
}

export async function markDepositSweepFailed(
  depositId: string,
  reason: string,
): Promise<void> {
  await getDb()
    .update(billingDeposits)
    .set({ sweepStatus: "failed", sweepTxDigest: null })
    .where(eq(billingDeposits.id, depositId));
  log.warn({ depositId, reason }, "billing.sweep: marked failed");
}
