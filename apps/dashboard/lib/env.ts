/**
 * Public client-side env.
 *
 * The dashboard browser talks to its OWN origin and Next.js rewrites
 * `/api/auth/*` and `/v1/*` to the backend (see next.config.mjs). That
 * keeps every fetch same-origin so no CORS or SameSite cookie surprises.
 *
 * `BACKEND_URL` is the empty string on the client (relative paths) and
 * the absolute backend host on the server, so server-side code in this
 * package can still reach the API if needed.
 */
const isBrowser = typeof window !== "undefined";

export const BACKEND_URL = isBrowser
  ? ""
  : (process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ??
    "http://localhost:3000");
