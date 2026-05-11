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
import { users } from "./users";

/**
 * On-chain encryption keys registered by users. Idempotency is on
 * (user, curve, sui_address): a user can hold multiple encryption
 * keys per curve as long as each is bound to a distinct signer
 * keypair (sui_address derives from signer pubkey). Without the
 * sui_address axis, seed rotations silently reuse the old row and
 * DKG fails opaquely at sign time.
 */
export const encryptionKeys = pgTable(
  "encryption_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sui network this key is registered on: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** Ika curve number: 0=SECP256K1, 1=SECP256R1, 2=ED25519, 3=RISTRETTO. */
    curve: integer("curve").notNull(),
    /** On-chain object id of the EncryptionKey object. */
    suiObjectId: text("sui_object_id").notNull(),
    /** Sui address that registered the key (signer pubkey -> address). */
    suiAddress: text("sui_address").notNull(),
    /** Tx digest of the registration. */
    suiTxDigest: text("sui_tx_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("encryption_keys_user_idx").on(t.userId),
    userNetworkIdx: index("encryption_keys_user_network_idx").on(
      t.userId,
      t.network,
    ),
    objectUnique: uniqueIndex("encryption_keys_object_unique").on(
      t.suiObjectId,
    ),
    userCurveAddressNetworkUnique: uniqueIndex(
      "encryption_keys_user_curve_address_network_unique",
    ).on(t.userId, t.curve, t.suiAddress, t.network),
  }),
);

export type EncryptionKey = typeof encryptionKeys.$inferSelect;
export type NewEncryptionKey = typeof encryptionKeys.$inferInsert;
