/**
 * Accounts read surface. Account creation happens inside the dwallets
 * onboarding PTB (`features/dwallets/service.ts::onboardZeroTrust`)
 * because in our model an Account exists only to hold dwallets, so
 * creating one without an initial dwallet would be wasted on-chain
 * state.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/shared/db/client";
import { type Account, accounts } from "@/shared/db/schema";

export async function findAccountForUser(
  userId: string,
  network: string,
): Promise<Account | undefined> {
  const rows = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.network, network)))
    .limit(1);
  return rows[0];
}

export async function listAccountsForUser(
  userId: string,
  network: string,
): Promise<Account[]> {
  return getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.network, network)))
    .orderBy(accounts.createdAt);
}

export async function recordAccount(args: {
  userId: string;
  network: string;
  suiObjectId: string;
  suiTxDigest: string;
}): Promise<Account> {
  const inserted = await getDb()
    .insert(accounts)
    .values({
      userId: args.userId,
      network: args.network,
      suiObjectId: args.suiObjectId,
      suiTxDigest: args.suiTxDigest,
    })
    .returning();
  return inserted[0]!;
}
