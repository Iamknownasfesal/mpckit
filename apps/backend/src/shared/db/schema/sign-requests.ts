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
 * Audit + idempotency log for sign operations. Clients pass an
 * idempotency key in the request header; if the same key arrives
 * twice we return the existing record instead of double-spending a
 * presign.
 *
 * Status transitions:
 *   `queued` -> `submitted` -> `completed`
 *                            \-> `failed`
 */
export const signRequests = pgTable(
  "sign_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sui network this sign request runs on: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** Client-supplied idempotency key. Unique per user. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Sui dwallet object id being signed under. */
    suiDwalletId: text("sui_dwallet_id").notNull(),
    presignId: uuid("presign_id"),
    curve: integer("curve").notNull(),
    signatureAlgorithm: integer("signature_algorithm").notNull(),
    hashScheme: integer("hash_scheme").notNull(),
    /** Hex of the bytes being signed; capped in handler before insert. */
    messageHex: text("message_hex").notNull(),
    /**
     * User-produced centralized message signature (hex). The
     * cryptographic auth for zero-trust signing; coordinator verifies
     * it server-side. Cleared after a sign completes for hygiene.
     */
    messageCentralizedSignatureHex: text("message_centralized_signature_hex"),
    /** Session identifier the worker uses when building the PTB. */
    sessionIdentifierHex: text("session_identifier_hex"),
    /** queued | submitted | completed | failed. */
    status: text("status").notNull().default("queued"),
    /** PTB digest once submitted. */
    txDigest: text("tx_digest"),
    /** Coordinator sign session id (poll target). */
    signSessionId: text("sign_session_id"),
    /** Final signature, hex. */
    signatureHex: text("signature_hex"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("sign_requests_user_idx").on(t.userId),
    userNetworkIdx: index("sign_requests_user_network_idx").on(
      t.userId,
      t.network,
    ),
    idemUnique: uniqueIndex("sign_requests_idem_unique").on(
      t.userId,
      t.network,
      t.idempotencyKey,
    ),
    statusIdx: index("sign_requests_status_idx").on(t.status),
  }),
);

export type SignRequest = typeof signRequests.$inferSelect;
export type NewSignRequest = typeof signRequests.$inferInsert;

export const SIGN_REQUEST_STATUS = {
  queued: "queued",
  submitted: "submitted",
  completed: "completed",
  failed: "failed",
} as const;
export type SignRequestStatus =
  (typeof SIGN_REQUEST_STATUS)[keyof typeof SIGN_REQUEST_STATUS];
