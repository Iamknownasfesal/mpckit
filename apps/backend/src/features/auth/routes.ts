/**
 * User + api-key management routes.
 *
 *   GET    /v1/users/me                 → whoami
 *   POST   /v1/users/me/api-keys        → issue a new key (plaintext returned ONCE)
 *   GET    /v1/users/me/api-keys        → list this user's keys (no plaintext)
 *   DELETE /v1/users/me/api-keys/:id    → revoke a key
 *   GET    /v1/users/me/audit           → recent audit events for this user
 *   POST   /v1/admin/users              → admin-only: create a user + initial key
 */
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { generateApiKey } from "@/features/auth/keys";
import { requireAdmin, requireAuth } from "@/http/middleware/auth";
import { auditFireAndForget } from "@/shared/audit";
import { getDb } from "@/shared/db/client";
import {
  type ApiKey,
  type AuditEvent,
  apiKeys,
  auditLog,
  type User,
  users,
} from "@/shared/db/schema";

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt.toISOString(),
  };
}

function publicAuditEvent(e: AuditEvent) {
  return {
    id: e.id,
    event: e.event,
    apiKeyId: e.apiKeyId,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  };
}

function publicKey(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    network: k.network,
    prefix: k.keyPrefix,
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  };
}

export const userRoutes = new Elysia({ prefix: "/v1" })
  .get(
    "/users/me",
    ({ request }) => {
      const { user, apiKey, kind } = requireAuth(request);
      return {
        user: publicUser(user),
        apiKey: apiKey ? publicKey(apiKey) : null,
        authKind: kind,
      };
    },
    {
      detail: {
        tags: ["users"],
        summary: "Whoami",
        description:
          'Returns the authenticated user and (when the request was authed via Bearer) the api key used. Dashboard session requests get `apiKey: null` and `authKind: "session"`.',
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/users/me/api-keys",
    async ({ request }) => {
      const { user } = requireAuth(request);
      const rows = await getDb()
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, user.id))
        .orderBy(apiKeys.createdAt);
      return { keys: rows.map(publicKey) };
    },
    {
      detail: {
        tags: ["users"],
        summary: "List api keys",
        description:
          "All api keys owned by the authenticated user. Plaintext is never returned: each row carries the key prefix, scopes, last-used + revocation timestamps, and id.",
        security: [{ bearer: [] }],
      },
    },
  )
  .post(
    "/users/me/api-keys",
    async ({ request, body }) => {
      const { user } = requireAuth(request);
      const network = body.network ?? "testnet";
      const issued = generateApiKey(network);
      const inserted = await getDb()
        .insert(apiKeys)
        .values({
          userId: user.id,
          network,
          keyHash: issued.hash,
          keyPrefix: issued.prefix,
          name: body.name,
          scopes: body.scopes ?? [],
        })
        .returning();
      const row = inserted[0]!;
      auditFireAndForget({
        event: "key.issued",
        userId: user.id,
        apiKeyId: row.id,
        requestId: request.headers.get("x-request-id"),
        metadata: { name: body.name, network, scopes: body.scopes ?? [] },
      });
      return {
        // Plaintext is shown ONCE — caller must persist it now.
        plaintext: issued.plaintext,
        key: publicKey(row),
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 64 }),
        network: t.Optional(
          t.Union([t.Literal("testnet"), t.Literal("mainnet")]),
        ),
        scopes: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }))),
      }),
      detail: {
        tags: ["users"],
        summary: "Issue api key",
        description:
          "Mints a new api key for the authenticated user. **The `plaintext` field is returned exactly once** and is never recoverable: persist it now or revoke and reissue. Subsequent reads return only the prefix, scopes, and metadata.",
        security: [{ bearer: [] }],
      },
    },
  )
  .get(
    "/users/me/audit",
    async ({ request, query }) => {
      const { user } = requireAuth(request);
      const limit = Math.min(
        Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1),
        200,
      );
      const rows = await getDb()
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.userId, user.id),
            notInArray(auditLog.event, ["auth.ok", "auth.ok.session"]),
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);
      return { events: rows.map(publicAuditEvent) };
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: {
        tags: ["users"],
        summary: "List audit events",
        description:
          "Recent audit events attributed to the authenticated user, newest first. Includes key issuance, key revocation, sign-ins, and any other append-only events the backend writes against this user. `limit` clamps to [1, 200]; default 50.",
        security: [{ bearer: [] }],
      },
    },
  )
  .delete(
    "/users/me/api-keys/:id",
    async ({ request, params, set }) => {
      const { user } = requireAuth(request);
      const updated = await getDb()
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, params.id),
            eq(apiKeys.userId, user.id),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });
      if (updated.length === 0) {
        set.status = 404;
        return { error: "key not found", code: "NOT_FOUND" };
      }
      auditFireAndForget({
        event: "key.revoked",
        userId: user.id,
        apiKeyId: params.id,
        requestId: request.headers.get("x-request-id"),
      });
      return { revoked: true };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      detail: {
        tags: ["users"],
        summary: "Revoke api key",
        description:
          "Marks an api key as revoked. Already-revoked or unknown keys return 404. Idempotent on a revoked key: subsequent calls return 404 rather than 200, since the key is no longer in scope.",
        security: [{ bearer: [] }],
      },
    },
  );

export const adminUserRoutes = new Elysia({ prefix: "/v1/admin" }).post(
  "/users",
  async ({ request, body }) => {
    requireAdmin(request);
    const network = body.network ?? "testnet";
    const issued = generateApiKey(network);
    const db = getDb();
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({
          email: body.email,
          name: body.name ?? null,
          isAdmin: body.isAdmin ?? false,
        })
        .returning();
      const user = inserted[0]!;
      const keyInserted = await tx
        .insert(apiKeys)
        .values({
          userId: user.id,
          network,
          keyHash: issued.hash,
          keyPrefix: issued.prefix,
          name: body.keyName ?? "initial",
          scopes: body.scopes ?? [],
        })
        .returning();
      const row = keyInserted[0]!;
      auditFireAndForget({
        event: "user.created",
        userId: user.id,
        apiKeyId: row.id,
        requestId: request.headers.get("x-request-id"),
        metadata: { email: body.email, isAdmin: body.isAdmin ?? false },
      });
      return {
        user: publicUser(user),
        key: { plaintext: issued.plaintext, ...publicKey(row) },
      };
    });
  },
  {
    body: t.Object({
      email: t.String({ format: "email", maxLength: 254 }),
      name: t.Optional(t.String({ maxLength: 200 })),
      isAdmin: t.Optional(t.Boolean()),
      network: t.Optional(
        t.Union([t.Literal("testnet"), t.Literal("mainnet")]),
      ),
      keyName: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
      scopes: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }))),
    }),
    detail: {
      tags: ["admin"],
      summary: "Create user + initial api key",
      description:
        "Creates a user and mints an initial api key in a single transaction. Returns the user, the new key's metadata, and the **one-time** plaintext. Admin only.",
      security: [{ bearer: [] }],
    },
  },
);
