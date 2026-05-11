/**
 * Mount Better-Auth's request handler under Elysia.
 *
 * Better-Auth owns every route under `/api/auth/*` (sign-in callback,
 * session refresh, passkey ceremonies, sign-out, etc.) and registers
 * them at variable depths — passkey routes are 4 segments deep
 * (`/api/auth/passkey/verify-authentication`), some auth routes are
 * 3. Elysia's `.mount()` rewrites the URL (Better-Auth then 404s on
 * its own basePath) and its `*` glob only matches a single segment.
 *
 * The clean way: intercept in `.onRequest`, which fires before routing,
 * and return a Response directly (`mapEarlyResponse` short-circuits the
 * rest of the lifecycle). We register this plugin first in elysia.ts so
 * its hook beats the other middleware to the request.
 *
 * Disabled (404 with a clear code) when `BETTER_AUTH_SECRET` is unset
 * so SDK-only deployments stay HTTP-clean.
 */
import { Elysia } from "elysia";
import { getAuth } from "./better-auth";

export const betterAuthRoutes = new Elysia({ name: "better-auth" }).onRequest(
  ({ request }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/auth")) return;
    const auth = getAuth();
    if (!auth) {
      return new Response(
        JSON.stringify({ error: "auth disabled", code: "AUTH_DISABLED" }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return auth.handler(request);
  },
);
