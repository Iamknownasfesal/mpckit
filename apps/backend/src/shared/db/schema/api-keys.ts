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

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Sui network this key is scoped to. Bound at issue time and
     * immutable: a test key can't reach mainnet, a live key can't reach
     * testnet. Reflected in the plaintext prefix (`mpckit_test_…` vs
     * `mpckit_live_…`) so it's visible to the operator at a glance.
     */
    network: text("network").notNull().default("testnet"),
    /** sha256(plaintext) hex. We never store plaintext. */
    keyHash: text("key_hash").notNull(),
    /** First 8 chars of the plaintext, kept for display in UIs. */
    keyPrefix: text("key_prefix").notNull(),
    /** Operator-given label, e.g. "ci", "prod-ingest". */
    name: text("name").notNull(),
    /**
     * Capability scopes. Empty array means "all default scopes".
     * Examples we'll grow into: "dwallet:create", "sign:request", "admin:*".
     */
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    keyHashUnique: uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
    userIdx: index("api_keys_user_idx").on(t.userId),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
