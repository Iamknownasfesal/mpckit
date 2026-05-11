/**
 * Curated scope catalogue used by the dashboard's API-key creator.
 *
 * Backend treats an empty `scopes` array as full access (see
 * `apps/backend/src/shared/db/schema/api-keys.ts`), and enforcement is
 * not wired into individual routes today, so this list is forward-
 * looking. The shape mirrors what we expect to enforce: `resource:verb`.
 */
export type Scope = {
  id: string;
  label: string;
  description: string;
  group: "dWallets" | "Signing" | "Billing" | "Account";
};

export const SCOPES: Scope[] = [
  {
    id: "dwallets:read",
    label: "Read dWallets",
    description: "List and inspect this account's dWallets.",
    group: "dWallets",
  },
  {
    id: "dwallets:write",
    label: "Create dWallets",
    description: "Onboard new dWallets and submit accept-share calls.",
    group: "dWallets",
  },
  {
    id: "sign:write",
    label: "Request signatures",
    description: "Submit signing requests against your dWallets.",
    group: "Signing",
  },
  {
    id: "billing:read",
    label: "Read billing",
    description: "Read balance, deposit address, pricing, and history.",
    group: "Billing",
  },
  {
    id: "accounts:read",
    label: "Read account",
    description: "Whoami and list the on-chain accounts you own.",
    group: "Account",
  },
];

export const SCOPE_GROUPS = Array.from(new Set(SCOPES.map((s) => s.group)));
