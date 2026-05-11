import { defaultNetwork } from "@/config/env";
import { getAuth } from "@/features/auth/better-auth";
import { hashKey, parseBearer } from "@/features/auth/keys";
import { loggerFor } from "@/http/middleware/request-logger";
import { auditFireAndForget } from "@/shared/audit";
import { getDb, isDbConfigured } from "@/shared/db/client";
import { type ApiKey, type User, apiKeys, users } from "@/shared/db/schema";
import { hasNetwork } from "@/shared/networks/registry";
/**
 * Bearer + session auth middleware.
 *
 * Two credential paths land on the same `Principal` shape:
 *
 *   - **API key** (`Authorization: Bearer mpckit_…`): hash, look up,
 *     attach `{ user, apiKey }`. Used by SDK callers.
 *   - **Session cookie** (Better-Auth): resolves to the user; no api
 *     key row is loaded, so `principal.apiKey` is `null`. Used by the
 *     dashboard. Admin checks still work via `user.isAdmin`.
 *
 * Routes that exclusively act *on behalf of a specific api key* (rare —
 * really just the rate limiter's per-key bucketing) call
 * `requireApiKey(p)` to assert the api-key branch.
 *
 * `requireAuth(ctx)` is the helper routes call to assert a principal.
 */
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";

export type AuthKind = "api_key" | "session";

export interface Principal {
  user: User;
  /** Present iff the request carried a `Bearer` api key. Sessions leave this null. */
  apiKey: ApiKey | null;
  kind: AuthKind;
}

const principalState = new WeakMap<Request, Principal>();

/**
 * Resolve a principal from the request, or `null` for anonymous.
 * Routes that require auth should call `requireAuth` instead.
 */
export function principalFor(request: Request): Principal | null {
  return principalState.get(request) ?? null;
}

/** Test-only: attach a principal to a request without going through auth. */
export function _setPrincipalForTest(request: Request, p: Principal): void {
  principalState.set(request, p);
}

/**
 * Throw a 401 if the request is unauthenticated.
 *
 * Routes call this at the top of their handler. We use a thrown Error
 * (vs returning early with `set.status = 401`) so Elysia's `onError`
 * lifecycle observes a uniform shape.
 */
export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function requireAuth(request: Request): Principal {
  const p = principalState.get(request);
  if (!p)
    throw new AuthError(401, "authentication required", "UNAUTHENTICATED");
  return p;
}

export function requireAdmin(request: Request): Principal {
  const p = requireAuth(request);
  if (!p.user.isAdmin) {
    throw new AuthError(403, "admin scope required", "FORBIDDEN");
  }
  return p;
}

export function requireScope(request: Request, scope: string): Principal {
  const p = requireAuth(request);
  if (p.user.isAdmin) return p; // admins inherit all scopes
  // Session-backed principals don't carry per-key scopes; we treat them
  // as if they had no extra scopes (only the default surface). Non-admin
  // sessions trying to hit a scoped endpoint correctly fail here.
  const scopes = p.apiKey?.scopes ?? [];
  if (!scopes.includes(scope)) {
    throw new AuthError(403, `missing scope: ${scope}`, "FORBIDDEN");
  }
  return p;
}

/**
 * Assert that the request was authed via an api key (not a session
 * cookie). Useful for rate-limit bucketing or audit attribution that
 * doesn't make sense without a key id.
 */
export function requireApiKey(p: Principal): ApiKey {
  if (!p.apiKey) {
    throw new AuthError(401, "api key required", "API_KEY_REQUIRED");
  }
  return p.apiKey;
}

export type IkaNetwork = "testnet" | "mainnet";

/**
 * Resolve the target Sui network for this request.
 *
 *   api-key auth: bound at issue time → comes from the key row.
 *                 `x-network` header is rejected if it disagrees so a
 *                 leaked test key can never reach mainnet by header flip.
 *
 *   session auth: dashboard ships `x-network` on every call; users
 *                 toggle live via the sidebar switcher.
 *
 * Falls back to the backend's default network only for fully
 * anonymous endpoints (e.g. `/v1/pricing`); gated routes always have a
 * principal.
 */
export function requestNetwork(request: Request): IkaNetwork {
  const p = principalFor(request);
  const header = request.headers.get("x-network");

  if (p?.apiKey) {
    const keyNet = p.apiKey.network as IkaNetwork;
    if (header && header !== keyNet) {
      throw new AuthError(
        401,
        `api key is scoped to ${keyNet}; x-network header set ${header}`,
        "NETWORK_MISMATCH",
      );
    }
    return keyNet;
  }

  if (!header) return defaultNetwork();
  if (header !== "testnet" && header !== "mainnet") {
    throw new AuthError(401, `unknown network: ${header}`, "INVALID_NETWORK");
  }
  if (!hasNetwork(header)) {
    throw new AuthError(
      403,
      `network ${header} is not enabled on this backend`,
      "NETWORK_DISABLED",
    );
  }
  return header;
}

async function resolveApiKey(
  plaintext: string,
): Promise<Principal | { error: string }> {
  const hash = hashKey(plaintext);
  const db = getDb();
  const rows = await db
    .select({
      key: apiKeys,
      user: users,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return { error: "unknown_key" };
  if (row.key.revokedAt !== null) return { error: "revoked" };
  if (row.key.expiresAt !== null && row.key.expiresAt.getTime() <= Date.now()) {
    return { error: "expired" };
  }
  return { user: row.user, apiKey: row.key, kind: "api_key" };
}

async function resolveSession(request: Request): Promise<Principal | null> {
  const auth = getAuth();
  if (!auth) return null;
  // Better-Auth validates the cookie + looks up the session row.
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  return { user, apiKey: null, kind: "session" };
}

function clientIp(req: Request): string | null {
  // Trust standard reverse-proxy headers when present. Operators that
  // expose this directly to the internet should configure their LB to
  // strip these on inbound requests.
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

export const authMiddleware = new Elysia({ name: "auth" }).onRequest(
  async ({ request }) => {
    // Better-Auth's own routes need to be reachable without our
    // middleware grabbing the request: it sets the session cookie on
    // its callback, our middleware would 401 before it gets there.
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth")) return;

    const plaintext = parseBearer(request.headers.get("authorization"));
    if (plaintext) {
      if (!isDbConfigured()) {
        // Server is running in DB-less mode (read-only public endpoints
        // only). Reject any inbound credential to make the surprise loud.
        throw new AuthError(401, "auth not available", "AUTH_UNAVAILABLE");
      }
      const result = await resolveApiKey(plaintext);
      if ("error" in result) {
        auditFireAndForget({
          event: `auth.fail.${result.error}`,
          requestId: request.headers.get("x-request-id"),
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent"),
        });
        throw new AuthError(401, "invalid api key", "INVALID_KEY");
      }
      principalState.set(request, result);
      // Touch last_used_at without blocking the request.
      const keyId = result.apiKey!.id;
      void getDb()
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyId))
        .catch((err: unknown) => {
          loggerFor(request).warn({ err, keyId }, "last_used_at update failed");
        });
      // Per-request `auth.ok` is intentionally NOT audited: it produces
      // one row per dashboard refresh and drowns real events. Key usage
      // is captured by `lastUsedAt` and rate-limit metrics; failures
      // below still audit.
      return;
    }

    // No bearer header; try the dashboard session cookie. Silent on
    // miss so anonymous requests stay anonymous (route guards decide).
    if (isDbConfigured()) {
      const session = await resolveSession(request).catch((err: unknown) => {
        loggerFor(request).warn({ err }, "session resolve failed");
        return null;
      });
      if (session) {
        principalState.set(request, session);
        // Same reasoning as above; session refreshes are not security
        // events worth one audit row each.
      }
    }
  },
);
