/**
 * Brand + URL constants for the dashboard. The marketing site has its
 * own copy under apps/docs/lib/site.ts — keeping them per-app means
 * each Next build is self-contained.
 */

const STRIP_TRAILING = (s: string) => s.replace(/\/$/, "");

export const SITE_NAME = "MpcKit";

export const SITE_TAGLINE = "Console";

export const SITE_DESCRIPTION =
  "Manage API keys, billing, and dWallets for your MpcKit account.";

export const SITE_URL = STRIP_TRAILING(
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://app.mpckit.xyz",
);

export const MARKETING_URL = STRIP_TRAILING(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mpckit.xyz",
);

export const AUTHOR_NAME = "fesal";

export const AUTHOR_URL = "https://github.com/Iamknownasfesal";
