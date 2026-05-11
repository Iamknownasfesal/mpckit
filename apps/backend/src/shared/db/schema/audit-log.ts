import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Append-only event stream. Anything we want to be able to reconstruct
 * after-the-fact lands here: auth attempts (success and failure), key
 * issuance and revocation, admin actions.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** e.g. "auth.ok", "auth.fail", "key.issued", "key.revoked". */
    event: text("event").notNull(),
    /** Optional actor (the authenticated user, if any). */
    userId: uuid("user_id"),
    /** Optional api key id involved. */
    apiKeyId: uuid("api_key_id"),
    /** Inbound request id; null for offline events (boot bootstrap). */
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Free-form structured payload. Keep PII out. */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    eventIdx: index("audit_log_event_idx").on(t.event),
    userIdx: index("audit_log_user_idx").on(t.userId),
    createdAtIdx: index("audit_log_created_at_idx").on(t.createdAt),
  }),
);

export type AuditEvent = typeof auditLog.$inferSelect;
export type NewAuditEvent = typeof auditLog.$inferInsert;
