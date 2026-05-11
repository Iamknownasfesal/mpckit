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
 * One row per credited deposit. The `(tx_digest)` unique constraint is
 * what makes the credit operation idempotent: a replayed POST or two
 * pods racing on the same digest both see at most one row land.
 *
 * `amount_atomic` and `credits_credited` are stored as text to preserve
 * full bigint precision; we never do arithmetic on them in SQL.
 */
export const billingDeposits = pgTable(
  "billing_deposits",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sui network this deposit lives on: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** Sui transaction digest the deposit was extracted from. */
    txDigest: text("tx_digest").notNull(),
    /** Sender address as observed on chain. Informational. */
    senderAddress: text("sender_address").notNull(),
    /** Full Sui coin type, e.g. `0x2::sui::SUI` or USDC type. */
    coinType: text("coin_type").notNull(),
    /** Atomic units credited from this deposit (text-encoded bigint). */
    amountAtomic: text("amount_atomic").notNull(),
    /** Micro-credits credited at the rate captured at credit time. */
    creditsCredited: bigint("credits_credited", { mode: "bigint" }).notNull(),
    /** Rate applied: micro-credits per 1 atomic unit. */
    rateMicroPerAtomic: text("rate_micro_per_atomic").notNull(),
    /** pending | swept | failed. Independent of credit settlement. */
    sweepStatus: text("sweep_status").notNull().default("pending"),
    /** Digest of the sweep tx that drained these funds, once it lands. */
    sweepTxDigest: text("sweep_tx_digest"),
    sweptAt: timestamp("swept_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    txDigestUnique: uniqueIndex("billing_deposits_digest_unique").on(
      t.txDigest,
    ),
    userIdx: index("billing_deposits_user_idx").on(t.userId, t.createdAt),
    userNetworkIdx: index("billing_deposits_user_network_idx").on(
      t.userId,
      t.network,
      t.createdAt,
    ),
  }),
);

export type BillingDeposit = typeof billingDeposits.$inferSelect;
export type NewBillingDeposit = typeof billingDeposits.$inferInsert;
