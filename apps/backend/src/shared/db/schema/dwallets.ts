import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { users } from "./users";

/**
 * dWallets created under an account. Status tracks the zero-trust
 * lifecycle:
 *   `awaiting_user_share` immediately after DKG submission,
 *   `active` once `accept_user_share` lands,
 *   `failed` if the DKG itself errored (we still record the row so
 *   audit / debugging is intact).
 */
export const dwallets = pgTable(
  "dwallets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Sui network this dWallet lives on: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** On-chain dWallet object id. */
    suiDwalletId: text("sui_dwallet_id").notNull(),
    /** Curve at DKG time. */
    curve: integer("curve").notNull(),
    /** Network encryption key the DKG ran against. */
    encryptionKeyId: text("encryption_key_id").notNull(),
    /**
     * On-chain Network Encryption Key id the dwallet is permanently
     * bound to. Read from `dwallet.dwallet_network_encryption_key_id`
     * on chain when the dwallet activates; lazy-backfilled for older
     * rows via `ensureDwalletNek`. Sign-time presign allocation must
     * match this NEK exactly — coordinator's
     * `validate_and_initiate_sign` aborts otherwise.
     */
    networkEncryptionKeyId: text("network_encryption_key_id"),
    /** zero_trust | shared. */
    kind: text("kind").notNull().default("zero_trust"),
    /** awaiting_user_share | active | failed. */
    status: text("status").notNull().default("awaiting_user_share"),
    /** Tx digest of the DKG request. */
    dkgTxDigest: text("dkg_tx_digest").notNull(),
    /** Tx digest of `accept_user_share`, populated when the dwallet activates. */
    acceptTxDigest: text("accept_tx_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("dwallets_user_idx").on(t.userId),
    userNetworkIdx: index("dwallets_user_network_idx").on(t.userId, t.network),
    accountIdx: index("dwallets_account_idx").on(t.accountId),
    networkNekIdx: index("dwallets_network_nek_idx").on(
      t.network,
      t.networkEncryptionKeyId,
    ),
    dwalletUnique: uniqueIndex("dwallets_sui_dwallet_unique").on(
      t.suiDwalletId,
    ),
  }),
);

export type DWallet = typeof dwallets.$inferSelect;
export type NewDWallet = typeof dwallets.$inferInsert;
