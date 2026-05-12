/**
 * Auth unit tests.
 *
 * Covers the pure surface: key generation/hashing, bearer parsing, the
 * AuthError guards (requireAuth / requireAdmin / requireScope) against a
 * manually-injected principal, and the rate-limit middleware's
 * fall-open behavior when REDIS_URL is unset.
 *
 * DB-dependent paths (resolvePrincipal, bootstrapAdmin, the admin/user
 * routes) need a real Postgres for meaningful coverage; see
 * docker-compose.yml.
 */
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  generateApiKey,
  hashesEqual,
  hashKey,
  parseBearer,
} from "@/features/auth/keys";
import {
  _setPrincipalForTest,
  AuthError,
  authMiddleware,
  principalFor,
  requireAdmin,
  requireAuth,
  requireScope,
} from "@/http/middleware/auth";
import { rateLimitMiddleware } from "@/http/middleware/rate-limit";
import type { ApiKey, User } from "@/shared/db/schema";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "u@example.com",
    name: "u",
    isAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    userId: "00000000-0000-0000-0000-000000000001",
    keyHash: "deadbeef",
    keyPrefix: "mpckit_test_xx",
    name: "test",
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("auth/keys", () => {
  test("generateApiKey returns a deterministic shape", () => {
    const k = generateApiKey();
    // mpckit_<env>_<base64url> — 7 + env + 1 + ~32
    expect(k.plaintext).toMatch(/^mpckit_(test|live)_[A-Za-z0-9_-]+$/);
    expect(k.prefix.length).toBe(16);
    expect(k.prefix).toBe(k.plaintext.slice(0, 16));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hash).toBe(hashKey(k.plaintext));
  });

  test("generateApiKey produces unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  test("parseBearer accepts well-formed headers", () => {
    expect(parseBearer("Bearer mpckit_test_abcdefghijklmnop")).toBe(
      "mpckit_test_abcdefghijklmnop",
    );
    expect(parseBearer("bearer mpckit_test_abcdefghijklmnop")).toBe(
      "mpckit_test_abcdefghijklmnop",
    );
  });

  test("parseBearer rejects junk", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Token abc")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
    expect(parseBearer("Bearer short")).toBeNull(); // < 16 chars
    expect(parseBearer(`Bearer ${"x".repeat(300)}`)).toBeNull(); // > 200 chars
  });

  test("hashesEqual is constant-time and length-checked", () => {
    const a = hashKey("plaintext-1");
    const b = hashKey("plaintext-2");
    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, b)).toBe(false);
    expect(hashesEqual(a, "deadbeef")).toBe(false);
  });
});

describe("auth guards", () => {
  test("requireAuth throws 401 when no principal is attached", () => {
    const req = new Request("http://localhost/v1/users/me");
    expect(() => requireAuth(req)).toThrow(AuthError);
    try {
      requireAuth(req);
    } catch (e) {
      const err = e as AuthError;
      expect(err.status).toBe(401);
      expect(err.code).toBe("UNAUTHENTICATED");
    }
  });

  test("requireAuth returns the attached principal", () => {
    const req = new Request("http://localhost/v1/users/me");
    const principal = { user: fakeUser(), apiKey: fakeKey() };
    _setPrincipalForTest(req, principal);
    expect(requireAuth(req)).toBe(principal);
    expect(principalFor(req)).toBe(principal);
  });

  test("requireAdmin: non-admin → 403", () => {
    const req = new Request("http://localhost/v1/admin/users");
    _setPrincipalForTest(req, {
      user: fakeUser({ isAdmin: false }),
      apiKey: fakeKey(),
    });
    try {
      requireAdmin(req);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as AuthError;
      expect(err.status).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });

  test("requireAdmin: admin passes", () => {
    const req = new Request("http://localhost/v1/admin/users");
    const principal = {
      user: fakeUser({ isAdmin: true }),
      apiKey: fakeKey(),
    };
    _setPrincipalForTest(req, principal);
    expect(requireAdmin(req)).toBe(principal);
  });

  test("requireScope: missing scope → 403", () => {
    const req = new Request("http://localhost/v1/sign");
    _setPrincipalForTest(req, {
      user: fakeUser({ isAdmin: false }),
      apiKey: fakeKey({ scopes: ["dwallet:read"] }),
    });
    try {
      requireScope(req, "sign:request");
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as AuthError;
      expect(err.status).toBe(403);
      expect(err.message).toContain("sign:request");
    }
  });

  test("requireScope: scope present passes", () => {
    const req = new Request("http://localhost/v1/sign");
    const principal = {
      user: fakeUser(),
      apiKey: fakeKey({ scopes: ["sign:request"] }),
    };
    _setPrincipalForTest(req, principal);
    expect(requireScope(req, "sign:request")).toBe(principal);
  });

  test("requireScope: admin inherits all scopes", () => {
    const req = new Request("http://localhost/v1/anything");
    const principal = {
      user: fakeUser({ isAdmin: true }),
      apiKey: fakeKey({ scopes: [] }),
    };
    _setPrincipalForTest(req, principal);
    expect(requireScope(req, "any:scope")).toBe(principal);
  });
});

describe("rate-limit fall-open", () => {
  test("anonymous request to /v1/health is not blocked when REDIS_URL unset", async () => {
    // No REDIS_URL in the env passed to the test runner → permissive
    // by design. We're verifying the no-Redis branch doesn't 429.
    const app = new Elysia()
      .use(rateLimitMiddleware)
      .get("/v1/health", () => ({ ok: true }));
    for (let i = 0; i < 5; i += 1) {
      const res = await app.handle(new Request("http://localhost/v1/health"));
      expect(res.status).toBe(200);
    }
  });

  test("anonymous request to a non-skip path passes when Redis missing", async () => {
    const app = new Elysia()
      .use(rateLimitMiddleware)
      .get("/v1/network", () => ({ ok: true }));
    const res = await app.handle(new Request("http://localhost/v1/network"));
    // No 429: with REDIS_URL unset the limiter falls open.
    expect(res.status).toBe(200);
  });
});

describe("authMiddleware no-credential pass-through", () => {
  test("request without Authorization header is treated as anonymous", async () => {
    const app = new Elysia()
      .use(authMiddleware)
      .get("/v1/who", ({ request }) => ({
        principal: principalFor(request),
      }));
    const res = await app.handle(new Request("http://localhost/v1/who"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principal: unknown };
    expect(body.principal).toBeNull();
  });
});
