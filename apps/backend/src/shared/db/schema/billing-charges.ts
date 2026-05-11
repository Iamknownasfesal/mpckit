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
 * Append-only ledger of every credit movement that isn't a deposit.
 * Charges are negative (debits); refunds are positive credits back to
 * the balance. The op-scoped unique index lets us make charges
 * idempotent per `(opType, opId, kind)` so a retried submit can't
 * double-debit and a retried refund can't double-credit.
 *
 *   kind = 'charge' | 'refund'
 */
export const billingCharges = pgTable(
  "billing_charges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sui network this charge applied to: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** What was being paid for, e.g. `dwallet.dkg`, `sign`, `presign-share`. */
    opType: text("op_type").notNull(),
    /** Reference into the originating row, usually a uuid. */
    opId: text("op_id").notNull(),
    kind: text("kind").notNull(), // charge | refund
    /** Signed delta to apply to balance. Negative for charges. */
    creditsMicro: bigint("credits_micro", { mode: "bigint" }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("billing_charges_user_idx").on(t.userId, t.createdAt),
    userNetworkIdx: index("billing_charges_user_network_idx").on(
      t.userId,
      t.network,
      t.createdAt,
    ),
    opUnique: uniqueIndex("billing_charges_op_unique").on(
      t.network,
      t.opType,
      t.opId,
      t.kind,
    ),
  }),
);

export type BillingCharge = typeof billingCharges.$inferSelect;
export type NewBillingCharge = typeof billingCharges.$inferInsert;
