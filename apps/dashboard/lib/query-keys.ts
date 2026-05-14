/**
 * Typed query-key factory. Pages used to inline stringly-typed arrays
 * like `["billing","balance",network]` and `["audit",{limit:100}]`,
 * which made invalidation fragile: one typo and the cache silently
 * splits in two. Channel everything through this factory so the
 * compiler enforces shape.
 */

import type { Network } from "./network";

export const queryKeys = {
  billing: {
    all: ["billing"] as const,
    balance: (network: Network) => ["billing", "balance", network] as const,
    address: (network: Network) => ["billing", "address", network] as const,
    pricing: () => ["billing", "pricing"] as const,
    history: (network: Network) => ["billing", "history", network] as const,
  },
  apiKeys: {
    all: ["api-keys"] as const,
  },
  dwallets: {
    all: (network: Network) => ["dwallets", network] as const,
    byId: (network: Network, id: string) => ["dwallets", network, id] as const,
  },
  audit: (limit: number) => ["audit", { limit }] as const,
  passkeys: {
    all: ["passkeys"] as const,
  },
  sessions: {
    all: ["sessions"] as const,
  },
} as const;
