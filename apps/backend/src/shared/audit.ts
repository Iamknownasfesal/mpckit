import { log } from "@/config/log";
import { getDb, isDbConfigured } from "@/shared/db/client";
/**
 * Audit log helper.
 *
 * Append-only writes to `audit_log`. Failures here are logged but
 * never bubble to the caller, because dropping a request because we
 * couldn't write to the audit log would be worse than dropping the
 * audit line.
 */
import { auditLog, type NewAuditEvent } from "@/shared/db/schema";

export interface AuditInput {
  event: string;
  userId?: string | null;
  apiKeyId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function audit(evt: AuditInput): Promise<void> {
  if (!isDbConfigured()) return;
  const row: NewAuditEvent = {
    event: evt.event,
    userId: evt.userId ?? null,
    apiKeyId: evt.apiKeyId ?? null,
    requestId: evt.requestId ?? null,
    ip: evt.ip ?? null,
    userAgent: evt.userAgent ?? null,
    metadata: evt.metadata ?? null,
  };
  try {
    await getDb().insert(auditLog).values(row);
  } catch (err) {
    log.warn({ err, event: evt.event }, "audit insert failed");
  }
}

/** Fire-and-forget: never blocks the request handler. */
export function auditFireAndForget(evt: AuditInput): void {
  void audit(evt);
}
