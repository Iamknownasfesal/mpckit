import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * `ika_api::account::Account` shared objects on Sui. The redesigned
 * contract has no on-chain account-level credential roster, so the
 * only stable identifier is the shared-object UID.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sui network this account lives on: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** On-chain Account shared object id. */
    suiObjectId: text("sui_object_id").notNull(),
    /** Tx digest of the registration. */
    suiTxDigest: text("sui_tx_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("accounts_user_idx").on(t.userId),
    userNetworkIdx: index("accounts_user_network_idx").on(t.userId, t.network),
    objectUnique: uniqueIndex("accounts_object_unique").on(t.suiObjectId),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
