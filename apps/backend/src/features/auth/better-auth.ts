import { env } from "@/config/env";
import { log } from "@/config/log";
import { getDb, isDbConfigured } from "@/shared/db/client";
import {
  authAccounts,
  authPasskeys,
  authSessions,
  authVerifications,
  users,
} from "@/shared/db/schema";
import { passkey } from "@better-auth/passkey";
/**
 * Better-Auth instance for the dashboard surface.
 *
 * Mounts /api/auth/* on Elysia. Sessions live in `auth_sessions`, OAuth
 * accounts in `auth_accounts`, magic-link / email-verify tokens in
 * `auth_verifications`, passkeys in `auth_passkeys`. The canonical
 * `users` row is reused — Better-Auth only adds `email_verified` and
 * `image`; everything else (`isAdmin`, `creditsMicro`, `depositAddress`)
 * stays under our control.
 *
 * Auth methods enabled in v1: GitHub OAuth + Passkey. Google, magic
 * link, and Sui SIWS land in follow-ups.
 *
 * Boot is best-effort: if `BETTER_AUTH_SECRET` is unset, the backend
 * still boots (SDK-only deployments don't need a dashboard surface),
 * and `getAuth()` returns `null`. Callers should treat `null` as
 * "dashboard auth disabled".
 */
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { suiSiwsPlugin } from "./siws-plugin";

export type AuthInstance = ReturnType<typeof betterAuth>;

let _auth: AuthInstance | null | undefined;

function build(): AuthInstance | null {
  const secret = env.BETTER_AUTH_SECRET;
  const baseURL = env.BETTER_AUTH_URL;
  if (!secret) {
    log.info(
      "BETTER_AUTH_SECRET not set: dashboard auth disabled (SDK key auth still works)",
    );
    return null;
  }
  if (!isDbConfigured()) {
    log.warn(
      "BETTER_AUTH_SECRET set but DATABASE_URL is empty: dashboard auth disabled",
    );
    return null;
  }
  if (!baseURL) {
    log.warn(
      "BETTER_AUTH_SECRET set without BETTER_AUTH_URL: dashboard auth disabled",
    );
    return null;
  }

  const db = getDb();

  const options: BetterAuthOptions = {
    secret,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: env.DASHBOARD_TRUSTED_ORIGINS,

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        passkey: authPasskeys,
      },
      // Our `users.id` is a database-generated uuid; Better-Auth
      // shouldn't try to mint its own text id on insert.
      usePlural: false,
    }),

    advanced: {
      database: {
        /**
         * Only the `user` table has a Postgres-side default
         * (`gen_random_uuid()`). All other Better-Auth tables —
         * sessions / accounts / verifications / passkeys — have
         * `text PRIMARY KEY` with no default, so Better-Auth must
         * generate a string id on insert.
         */
        generateId: ({ model }) => {
          if (model === "user") return false;
          // Default Better-Auth nanoid-style identifier.
          return crypto.randomUUID();
        },
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
      },
    },

    // Email + password is explicitly off — operator decision: no
    // passwords on this surface, only OAuth / passkey / (later) magic
    // links + SIWS.
    emailAndPassword: { enabled: false },

    socialProviders:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : undefined,

    plugins: [
      passkey({
        rpName: "MpcKit",
        // rpID auto-derives from baseURL's hostname (port-independent).
        // The `origin` allowlist DOES include the port: the browser
        // creates credentials at the dashboard origin (localhost:3011
        // in dev, app.mpckit.xyz in prod) which differs from the
        // backend's own URL, so we pass the dashboard origins through.
        origin: env.DASHBOARD_TRUSTED_ORIGINS,
      }),
      /**
       * Sign-In With Sui. Custom plugin: a Sui wallet (Slush, Suiet,
       * Phantom-Sui, …) signs a nonce + statement, the backend
       * verifies the signature against the claimed address and mints
       * a session. Creates the user on first sign-in.
       */
      suiSiwsPlugin(),
    ],
  };

  return betterAuth(options);
}

export function getAuth(): AuthInstance | null {
  if (_auth !== undefined) return _auth;
  _auth = build();
  return _auth;
}
