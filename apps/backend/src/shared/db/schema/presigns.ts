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

/**
 * Pool of `UnverifiedPresignCap` objects owned by the operator hot
 * wallet, broken into buckets by `(curve, signature_algorithm)`.
 *
 * Sign worker pops a `ready` row via `SELECT … FOR UPDATE SKIP LOCKED`
 * and atomically transitions to `allocated`. After PTB submission the
 * row goes to `consumed_pending` until on-chain confirmation (then
 * `used`). On any failure path the row rolls back to `ready` so the
 * cap isn't leaked.
 *
 * State machine:
 *   `pending`          requested, coordinator hasn't computed network share yet
 *   `ready`            available for allocation
 *   `allocated`        locked to a sign request, PTB not yet submitted
 *   `consumed_pending` PTB submitted, awaiting Sui finality + sign result
 *   `used`             consumed by a successful sign
 *   `failed`           coordinator rejected, or stuck pending past timeout
 */
export const presigns = pgTable(
  "presigns",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Sui network this presign was minted on: 'testnet' | 'mainnet'. */
    network: text("network").notNull().default("testnet"),
    /** On-chain UnverifiedPresignCap object id. */
    suiObjectId: text("sui_object_id").notNull(),
    curve: integer("curve").notNull(),
    signatureAlgorithm: integer("signature_algorithm").notNull(),
    /** Network encryption key the presign is bound to. */
    networkEncryptionKeyId: text("network_encryption_key_id").notNull(),
    status: text("status").notNull().default("pending"),
    /** Tx digest of the batch that minted this presign. */
    requestTxDigest: text("request_tx_digest").notNull(),
    /** Sign request that consumed it. */
    signRequestId: uuid("sign_request_id"),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    objectUnique: uniqueIndex("presigns_object_unique").on(t.suiObjectId),
    /** Hot path: WHERE network=? AND curve=? AND signature_algorithm=? AND status='ready' */
    /** ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED. */
    bucketStatusIdx: index("presigns_bucket_status_idx").on(
      t.network,
      t.curve,
      t.signatureAlgorithm,
      t.status,
    ),
  }),
);

export type Presign = typeof presigns.$inferSelect;
export type NewPresign = typeof presigns.$inferInsert;

export const PRESIGN_STATUS = {
  pending: "pending",
  ready: "ready",
  allocated: "allocated",
  consumedPending: "consumed_pending",
  used: "used",
  failed: "failed",
} as const;
export type PresignStatus =
  (typeof PRESIGN_STATUS)[keyof typeof PRESIGN_STATUS];
