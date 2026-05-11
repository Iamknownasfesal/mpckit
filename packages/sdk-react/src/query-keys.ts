/**
 * Centralised query keys so callers can `qc.invalidateQueries(...)` and
 * `qc.cancelQueries(...)` without hardcoding tuples. Hooks and
 * mutations all reference these.
 */
export const mpcKitQueryKeys = {
  all: ["mpckit"] as const,
  balance: () => [...mpcKitQueryKeys.all, "balance"] as const,
  billingHistory: () => [...mpcKitQueryKeys.all, "billing-history"] as const,
  depositAddress: () => [...mpcKitQueryKeys.all, "deposit-address"] as const,
  dwallets: () => [...mpcKitQueryKeys.all, "dwallets"] as const,
  dwallet: (id: string) => [...mpcKitQueryKeys.all, "dwallet", id] as const,
  networkInfo: () => [...mpcKitQueryKeys.all, "network"] as const,
  pricing: () => [...mpcKitQueryKeys.all, "pricing"] as const,
};
