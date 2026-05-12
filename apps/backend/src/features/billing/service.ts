import { and, desc, eq, sql } from "drizzle-orm";
import { env, type IkaNetwork } from "@/config/env";
import {
  creditsFor,
  type VerifiedDeposit,
  verifyDeposit,
} from "@/features/billing/verifier";
import { deriveDepositAddress } from "@/shared/billing/derive";
import { getDb } from "@/shared/db/client";
import {
  type BillingCharge,
  type BillingDeposit,
  billingAccounts,
  billingCharges,
  billingDeposits,
} from "@/shared/db/schema";
import { errors } from "@/shared/errors";
import { enqueue } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";

async function getOrCreateAccount(userId: string, network: string) {
  const db = getDb();
  const existing = await db
    .select()
    .from(billingAccounts)
    .where(
      and(
        eq(billingAccounts.userId, userId),
        eq(billingAccounts.network, network),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(billingAccounts)
    .values({ userId, network })
    .onConflictDoNothing({
      target: [billingAccounts.userId, billingAccounts.network],
    })
    .returning();
  if (inserted[0]) return inserted[0];
  // Lost the race; fetch the row the other writer landed.
  const after = await db
    .select()
    .from(billingAccounts)
    .where(
      and(
        eq(billingAccounts.userId, userId),
        eq(billingAccounts.network, network),
      ),
    )
    .limit(1);
  if (!after[0]) throw errors.internal("billing account upsert lost");
  return after[0];
}

export async function getOrCreateDepositAddress(
  userId: string,
  network: string,
): Promise<string> {
  const account = await getOrCreateAccount(userId, network);
  if (account.depositAddress) return account.depositAddress;
  const address = deriveDepositAddress(userId, network);
  await getDb()
    .update(billingAccounts)
    .set({ depositAddress: address, updatedAt: new Date() })
    .where(eq(billingAccounts.id, account.id));
  return address;
}

export async function getBalance(
  userId: string,
  network: string,
): Promise<bigint> {
  const account = await getOrCreateAccount(userId, network);
  return account.creditsMicro;
}

export interface RecordDepositResult {
  deposit: BillingDeposit;
  duplicate: boolean;
  newBalanceMicro: bigint;
}

export async function recordDeposit(
  userId: string,
  network: string,
  txDigest: string,
): Promise<RecordDepositResult> {
  const db = getDb();

  // Fast path: this digest has already been credited.
  const prior = await db
    .select()
    .from(billingDeposits)
    .where(eq(billingDeposits.txDigest, txDigest))
    .limit(1);
  if (prior[0]) {
    if (prior[0].userId !== userId) {
      throw errors.conflict(
        "deposit already credited to another user",
        "DEPOSIT_TAKEN",
      );
    }
    if (prior[0].network !== network) {
      throw errors.conflict(
        "deposit already credited on another network",
        "DEPOSIT_TAKEN",
      );
    }
    const balance = await getBalance(userId, network);
    return { deposit: prior[0], duplicate: true, newBalanceMicro: balance };
  }

  const recipient = await getOrCreateDepositAddress(userId, network);
  const verified = await verifyDeposit(
    network as IkaNetwork,
    txDigest,
    recipient,
  );

  let preTotal = 0n;
  for (const [coinType, atomic] of verified.amountsAtomic) {
    preTotal += creditsFor(coinType, atomic).credits;
  }
  const minMicro = BigInt(env.BILLING_MIN_DEPOSIT_MICRO);
  if (preTotal < minMicro) {
    throw errors.unprocessable(
      `deposit below minimum: ${preTotal} micro-credits < ${minMicro} required`,
      "DEPOSIT_BELOW_MINIMUM",
    );
  }

  await getOrCreateAccount(userId, network);

  const result = await db.transaction(async (tx) => {
    let totalCredits = 0n;
    let lastInserted: BillingDeposit | undefined;
    for (const [coinType, atomic] of verified.amountsAtomic) {
      const { credits, rate } = creditsFor(coinType, atomic);
      const inserted = await tx
        .insert(billingDeposits)
        .values({
          userId,
          network,
          txDigest: suffixForCoinType(verified, coinType),
          senderAddress: verified.sender,
          coinType,
          amountAtomic: atomic.toString(),
          creditsCredited: credits,
          rateMicroPerAtomic: rate.toString(),
          sweepStatus: "pending",
        })
        .returning();
      lastInserted = inserted[0]!;
      totalCredits += credits;
    }
    const updated = await tx
      .update(billingAccounts)
      .set({
        creditsMicro: sql`${billingAccounts.creditsMicro} + ${totalCredits}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingAccounts.userId, userId),
          eq(billingAccounts.network, network),
        ),
      )
      .returning({ creditsMicro: billingAccounts.creditsMicro });
    return {
      deposit: lastInserted!,
      newBalanceMicro: updated[0]!.creditsMicro,
    };
  });

  await enqueue(JOBS.billingSweep, {
    userId,
    network: network as IkaNetwork,
    depositId: result.deposit.id,
  });

  return { ...result, duplicate: false };
}

export interface ChargeArgs {
  userId: string;
  network: string;
  opType: string;
  opId: string;
  amountMicro: bigint;
  reason?: string;
}

/**
 * Atomic debit. Idempotent on `(network, opType, opId, kind=charge)`.
 */
export async function charge(args: ChargeArgs): Promise<BillingCharge> {
  if (args.amountMicro <= 0n) {
    throw errors.validation("charge amount must be > 0", "BAD_CHARGE_AMOUNT");
  }
  await getOrCreateAccount(args.userId, args.network);
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(billingCharges)
      .where(
        and(
          eq(billingCharges.network, args.network),
          eq(billingCharges.opType, args.opType),
          eq(billingCharges.opId, args.opId),
          eq(billingCharges.kind, "charge"),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const accountRows = await tx
      .select({ creditsMicro: billingAccounts.creditsMicro })
      .from(billingAccounts)
      .where(
        and(
          eq(billingAccounts.userId, args.userId),
          eq(billingAccounts.network, args.network),
        ),
      )
      .for("update")
      .limit(1);
    if (!accountRows[0]) {
      throw errors.notFound(
        "billing account not found",
        "BILLING_ACCOUNT_NOT_FOUND",
      );
    }
    if (accountRows[0].creditsMicro < args.amountMicro) {
      throw errors.paymentRequired(
        `insufficient credits: have ${accountRows[0].creditsMicro}, need ${args.amountMicro}`,
        "INSUFFICIENT_CREDITS",
      );
    }
    await tx
      .update(billingAccounts)
      .set({
        creditsMicro: sql`${billingAccounts.creditsMicro} - ${args.amountMicro}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingAccounts.userId, args.userId),
          eq(billingAccounts.network, args.network),
        ),
      );
    const inserted = await tx
      .insert(billingCharges)
      .values({
        userId: args.userId,
        network: args.network,
        opType: args.opType,
        opId: args.opId,
        kind: "charge",
        creditsMicro: -args.amountMicro,
        reason: args.reason ?? null,
      })
      .returning();
    return inserted[0]!;
  });
}

export interface RefundArgs {
  userId: string;
  network: string;
  opType: string;
  opId: string;
  amountMicro: bigint;
  reason: string;
}

/**
 * Idempotent refund. Pairs with a prior `charge` row but doesn't require
 * one. Unique on `(network, opType, opId, kind=refund)`.
 */
export async function refund(args: RefundArgs): Promise<BillingCharge> {
  if (args.amountMicro <= 0n) {
    throw errors.validation("refund amount must be > 0", "BAD_REFUND_AMOUNT");
  }
  await getOrCreateAccount(args.userId, args.network);
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(billingCharges)
      .where(
        and(
          eq(billingCharges.network, args.network),
          eq(billingCharges.opType, args.opType),
          eq(billingCharges.opId, args.opId),
          eq(billingCharges.kind, "refund"),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    await tx
      .update(billingAccounts)
      .set({
        creditsMicro: sql`${billingAccounts.creditsMicro} + ${args.amountMicro}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingAccounts.userId, args.userId),
          eq(billingAccounts.network, args.network),
        ),
      );
    const inserted = await tx
      .insert(billingCharges)
      .values({
        userId: args.userId,
        network: args.network,
        opType: args.opType,
        opId: args.opId,
        kind: "refund",
        creditsMicro: args.amountMicro,
        reason: args.reason,
      })
      .returning();
    return inserted[0]!;
  });
}

export async function listDeposits(
  userId: string,
  network: string,
  limit = 50,
): Promise<BillingDeposit[]> {
  return getDb()
    .select()
    .from(billingDeposits)
    .where(
      and(
        eq(billingDeposits.userId, userId),
        eq(billingDeposits.network, network),
      ),
    )
    .orderBy(desc(billingDeposits.createdAt))
    .limit(limit);
}

export async function listCharges(
  userId: string,
  network: string,
  limit = 100,
): Promise<BillingCharge[]> {
  return getDb()
    .select()
    .from(billingCharges)
    .where(
      and(
        eq(billingCharges.userId, userId),
        eq(billingCharges.network, network),
      ),
    )
    .orderBy(desc(billingCharges.createdAt))
    .limit(limit);
}

/**
 * One Sui tx can carry both SUI and USDC; we store one ledger row per
 * coin type, but the underlying digest is the same. Suffix with the
 * coin's last 8 chars to keep `(tx_digest)` unique per ledger row
 * while still letting humans correlate by the prefix.
 */
function suffixForCoinType(
  verified: VerifiedDeposit,
  coinType: string,
): string {
  if (verified.amountsAtomic.size === 1) return verified.digest;
  const tail = coinType.slice(-8);
  return `${verified.digest}:${tail}`;
}

export function priceFor(opType: keyof typeof OP_PRICES): bigint {
  return BigInt(OP_PRICES[opType]);
}

export const OP_PRICES = {
  "encryption-key": env.BILLING_PRICE_ENCRYPTION_KEY_MICRO,
  "dwallet.dkg": env.BILLING_PRICE_DKG_MICRO,
  sign: env.BILLING_PRICE_SIGN_MICRO,
} as const;
