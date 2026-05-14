/**
 * Best-effort client IP extraction from a Fetch `Request`.
 *
 * Trusts standard reverse-proxy headers when present. Operators that
 * expose this directly to the internet should configure their LB to
 * strip these on inbound requests (documented limitation).
 *
 * Returns `null` when no header is present; rate-limiter buckets and
 * audit-log rows fall back to a literal "unknown" via `?? "unknown"`.
 */
export function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}
