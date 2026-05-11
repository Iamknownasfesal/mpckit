/**
 * Centralised brand + URL constants used across the marketing pages,
 * docs MDX, and generated metadata. Override the hostnames with
 * NEXT_PUBLIC_* envs at build time when targeting a non-prod
 * deployment (e.g. *-testnet.mpckit.xyz).
 */

export const SITE_NAME = "MpcKit";

export const SITE_TAGLINE = "Sign on every chain from one API.";

export const SITE_DESCRIPTION =
  "Hosted MPC signing for crypto products. One bearer token, every chain that matters, no private keys held on your servers.";

const STRIP_TRAILING = (s: string) => s.replace(/\/$/, "");

export const SITE_URL = STRIP_TRAILING(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mpckit.xyz",
);

export const DASHBOARD_URL = STRIP_TRAILING(
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://app.mpckit.xyz",
);

export const DOCS_URL = STRIP_TRAILING(
  process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.mpckit.xyz",
);

export const GITHUB_URL = "https://github.com/Iamknownasfesal/mpckit";

export const AUTHOR_NAME = "fesal";

export const AUTHOR_URL = "https://github.com/Iamknownasfesal";

export const TWITTER_HANDLE = "@ikadotxyz";
