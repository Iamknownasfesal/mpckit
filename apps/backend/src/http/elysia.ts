import { swagger } from "@elysiajs/swagger";
/**
 * Elysia composition. Builds the HTTP app from feature route plugins;
 * the API entrypoint (`src/api.ts`) calls `buildApp()` after the boot
 * sequence (DB migrate, ika client warmup) finishes.
 *
 * Uniform error handling lives here: `AppError` becomes a clean
 * `{error, code}` JSON with the carried status; everything else maps
 * to a 500 with the message scrubbed for production.
 *
 * `App` is exported as a TypeScript type so the SDK + React bindings
 * can consume it via `@elysiajs/eden` for end-to-end type safety
 * without a code-gen step. The runtime never crosses the package
 * boundary — only the inferred type does.
 */
import { Elysia } from "elysia";
import { env } from "@/config/env";
import { Sentry } from "@/config/telemetry";
import { accountRoutes } from "@/features/accounts/routes";
import { betterAuthRoutes } from "@/features/auth/better-auth-routes";
import { adminUserRoutes, userRoutes } from "@/features/auth/routes";
import { billingRoutes } from "@/features/billing/routes";
import { dwalletRoutes } from "@/features/dwallets/routes";
import { encryptionKeyRoutes } from "@/features/encryption-keys/routes";
import { healthRoutes } from "@/features/health/routes";
import { metricsRoutes } from "@/features/metrics/routes";
import { networkRoutes } from "@/features/network/routes";
import { presignAdminRoutes } from "@/features/presigns/routes";
import { pricingRoutes } from "@/features/pricing/routes";
import { protocolParameterRoutes } from "@/features/protocol-parameters/routes";
import { signRoutes } from "@/features/sign/routes";
import { AuthError, authMiddleware } from "@/http/middleware/auth";
import { rateLimitMiddleware } from "@/http/middleware/rate-limit";
import { loggerFor, requestLogger } from "@/http/middleware/request-logger";
import { AppError } from "@/shared/errors";

export function buildApp() {
  // No CORS plugin: the dashboard reaches the backend via a Next.js
  // rewrite (apps/dashboard/next.config.mjs) so requests are same-origin
  // from the browser's perspective. SDK callers send Bearer tokens from
  // their own servers and never run cross-origin. Re-add @elysiajs/cors
  // only if a true browser-cross-origin SDK consumer shows up.
  return (
    new Elysia()
      // First: intercept /api/auth/* and hand it off to Better-Auth
      // before any other middleware can touch the request. Bearer auth,
      // rate-limit, and request-logger don't fire for auth routes.
      .use(betterAuthRoutes)
      .use(requestLogger)
      .use(authMiddleware)
      .use(rateLimitMiddleware)
      .use(
        swagger({
          path: "/docs",
          documentation: {
            info: {
              title: "MPCKit API",
              version: "0.0.0",
              description:
                "Hosted MPCKit dWallet gateway. SDKs talk to this surface; consult the Self-host guide for running your own tenant.",
              license: {
                name: "BSD-3-Clause",
                url: "https://opensource.org/license/bsd-3-clause",
              },
            },
            components: {
              securitySchemes: {
                bearer: {
                  type: "http",
                  scheme: "bearer",
                  description:
                    "API key issued by the operator. Format: `mpckit_live_…` or `mpckit_test_…` for test deploys.",
                },
              },
            },
            security: [{ bearer: [] }],
            tags: [
              {
                name: "billing",
                description: "USD-denominated credit ledger.",
              },
              {
                name: "dwallets",
                description: "Zero-trust dWallet lifecycle.",
              },
              { name: "sign", description: "Two-phase sign requests." },
              {
                name: "network",
                description: "Live network + protocol metadata.",
              },
              { name: "admin", description: "Operator-only admin surface." },
            ],
          },
        }),
      )
      .onError(({ error, code, set, request }) => {
        if (error instanceof AppError) {
          set.status = error.status;
          return { error: error.message, code: error.code };
        }
        if (error instanceof AuthError) {
          set.status = error.status;
          return { error: error.message, code: error.code };
        }
        // Fall through: unexpected error.
        loggerFor(request).error({ err: error, code }, "request error");
        const status =
          code === "VALIDATION" ? 400 : code === "NOT_FOUND" ? 404 : 500;
        // Sentry only sees the unexpected branch: AppError / AuthError
        // are part of the API contract and shouldn't page anyone.
        // No-op if `SENTRY_DSN` is unset.
        if (status >= 500 && error instanceof Error) {
          Sentry.captureException(error, {
            tags: { http_status: String(status), error_code: String(code) },
          });
        }
        set.status = status;
        // Elysia validation errors carry actionable detail (which field
        // failed, expected shape) — clients need that to fix their
        // request, so we keep the original message for VALIDATION even
        // in prod. Everything else with a 500-class status surfaces a
        // generic message in production so DB driver text, internal
        // paths, or stack-trace fragments don't leak to the client.
        // The real message is still in the structured log above.
        const isProd = env.NODE_ENV === "production";
        const safeMessage =
          isProd && status >= 500
            ? "internal error"
            : error instanceof Error
              ? error.message
              : "internal error";
        return {
          error: safeMessage,
          code: typeof code === "string" ? code : "INTERNAL_ERROR",
        };
      })
      .use(healthRoutes)
      .use(networkRoutes)
      .use(pricingRoutes)
      .use(protocolParameterRoutes)
      .use(userRoutes)
      .use(adminUserRoutes)
      .use(encryptionKeyRoutes)
      .use(accountRoutes)
      .use(billingRoutes)
      .use(dwalletRoutes)
      .use(signRoutes)
      .use(presignAdminRoutes)
      .use(metricsRoutes)
  );
}

export type App = ReturnType<typeof buildApp>;
