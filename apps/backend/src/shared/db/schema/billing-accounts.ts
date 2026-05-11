import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Per-(user, network) billing row. Credits and the HKDF-derived
 * deposit address live here instead of on the user, so a single user
 * identity can hold testnet and mainnet balances independently.
 * Looked up as `(user_id, network)`; rows are created lazily by the
 * billing service the first time a user touches a network.
 */
export const billingAccounts = pgTable(
  "billing_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    /** Off-chain credit balance in micro-credits (10^-6) on this network. */
    creditsMicro: bigint("credits_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    /**
     * Per-(user, network) clearinghouse Sui address. Derived via
     * HKDF(BILLING_DEPOSIT_MASTER_SEED_HEX, userId || network) and
     * cached here. The matching keypair is never stored; the sweep
     * worker re-derives it on demand.
     */
    depositAddress: text("deposit_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userNetworkUnique: uniqueIndex("billing_accounts_user_network_unique").on(
      t.userId,
      t.network,
    ),
    userIdx: index("billing_accounts_user_idx").on(t.userId),
  }),
);

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type NewBillingAccount = typeof billingAccounts.$inferInsert;
