# `@mpckit/react` reference

React bindings over `@mpckit/sdk`. Provider + 10 TanStack Query hooks. Peer deps: `react >=18`, `@tanstack/react-query >=5`. The consumer owns the `QueryClient`.

## Install

```bash
bun add @mpckit/react @tanstack/react-query react
```

`@mpckit/sdk` is pulled in transitively; you do not import from it directly except for enums (`Curve`, `Hash`, `SignatureAlgorithm`) which are re-exported from `@mpckit/react` for convenience.

## Provider

```tsx
import { MPCKitProvider } from "@mpckit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MPCKitProvider
        options={{
          apiKey: import.meta.env.VITE_MPCKIT_API_KEY,
          network: "testnet",
        }}
        useWorker
        workerFactory={() =>
          new Worker(new URL("@mpckit/sdk/worker-impl", import.meta.url), {
            type: "module",
          })
        }
      >
        {children}
      </MPCKitProvider>
    </QueryClientProvider>
  );
}
```

### Props

| prop | type | notes |
|---|---|---|
| `options` | `Omit<MPCKitOptions, "crypto">` | `apiKey`, `network`, optional `baseUrl`, `suiRpcUrl`, `timeoutMs`. `crypto` is wired by the provider itself. |
| `useWorker` | `boolean` | Wires `WebWorkerCryptoEngine`. Required for browser apps that cannot block on multi-second WASM ceremonies. Server-rendered pages leave it off. |
| `workerFactory` | `() => Worker` | Required when `useWorker` is on. Bundler-specific (see below). |
| `crypto` | `CryptoEngine` | Override the engine entirely. Useful for tests; otherwise leave undefined. |

### Worker factory by bundler

| Bundler | Pattern |
|---|---|
| Vite, Next.js Turbopack, Remix v3 | `() => new Worker(new URL("@mpckit/sdk/worker-impl", import.meta.url), { type: "module" })` |
| Next.js Webpack (pages router) | Use a module-worker plugin or migrate to Turbopack; the `new URL` pattern requires bundler support. |
| Bun (server-rendered) | Do not pass `useWorker`; the inline engine is already fast enough on Bun. |

### SSR

`MPCKitProvider` is safe to mount in a React Server Component tree, but only the *client* component leaf can be `MPCKitProvider`. The worker only constructs in the browser (`useEffect`), so SSR builds produce no Worker references. The `workerFactory` you pass must be evaluated in the browser; in Next.js App Router, place the provider in a `"use client"` file.

## Hooks

All hooks consume the provider's `MPCKit` instance via `useMPCKit()` internally; you almost never call `useMPCKit()` yourself except for the imperative escape hatches.

### Reads (queries)

```tsx
import {
  useBalance,
  useBillingHistory,
  useDepositAddress,
  useDWallet,
  useDWallets,
  useNetworkInfo,
  usePricing,
} from "@mpckit/react";

const { data: dwallets } = useDWallets();
const { data: dwallet }  = useDWallet(dwalletId);          // null on empty id
const { data: balance }  = useBalance();
const { data: pricing }  = usePricing();
const { data: depositA } = useDepositAddress();
const { data: history }  = useBillingHistory({ limit: 50 });
const { data: network }  = useNetworkInfo();
```

These compose with TanStack Query directly: pass a `queryKey` selector / `enabled` flag / `staleTime` / `refetchInterval` through the second positional options object.

```tsx
const { data, isPending } = useDWallets({
  refetchInterval: 4000,
  staleTime: 0,
});
```

### Mutations

```tsx
import { useDeclareDeposit, useOnboard, useSign } from "@mpckit/react";

const declareDeposit = useDeclareDeposit();
const onboard = useOnboard();
const sign = useSign();

// Trigger
await onboard.mutateAsync({ seed, curve: Curve.SECP256K1 });
await sign.mutateAsync({
  seed,
  dwalletId,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.SHA256,
  message: new TextEncoder().encode("hello"),
  userSecretKeyShareHex,
});
```

`useOnboard()` and `useSign()` automatically invalidate `useDWallets()` / `useBalance()` / `useBillingHistory()` on success.

### Imperative escape hatches

```tsx
import { useMPCKit, useEdenClient, mpcKitQueryKeys } from "@mpckit/react";

const api = useMPCKit();    // raw MPCKit instance from @mpckit/sdk
const eden = useEdenClient(); // typed Treaty client for routes not on MPCKit
queryClient.invalidateQueries({ queryKey: mpcKitQueryKeys.dwallets() });
```

`mpcKitQueryKeys` is the typed factory used by all built-in hooks. Use it for `qc.invalidateQueries` / `qc.refetchQueries` from custom code so your invalidations match the hooks' cache keys.

## Re-exports from `@mpckit/sdk`

`@mpckit/react` re-exports the enums and error classes so you do not need a direct dependency on `@mpckit/sdk`:

```tsx
import {
  Curve,
  Hash,
  SignatureAlgorithm,
  MPCKitError,
  MPCKitInsufficientCreditsError,
  MPCKitTimeoutError,
  defaultBaseUrl,
  MPCKIT_HOSTS,
} from "@mpckit/react";
```

## Patterns

### Onboard once, render the dWallet

```tsx
function CreateWallet({ seed }: { seed: Uint8Array }) {
  const onboard = useOnboard();
  return (
    <button
      onClick={async () => {
        const result = await onboard.mutateAsync({ seed, curve: Curve.SECP256K1 });
        // persist result.userSecretKeyShareHex next to result.dwallet.id
      }}
      disabled={onboard.isPending}
    >
      {onboard.isPending ? "Onboarding..." : "Create dWallet"}
    </button>
  );
}
```

### Poll a dWallet until Active

```tsx
const { data: dwallet } = useDWallet(id, {
  refetchInterval: (q) => (q.state.data?.state.kind === "Active" ? false : 2000),
});
```

### Disable a query on missing input

```tsx
const { data } = useDWallet(id, { enabled: Boolean(id) });
```

## What `@mpckit/react` does not handle

- **Web Worker construction.** You pass `workerFactory`. The Provider terminates the worker on unmount and re-constructs on options change.
- **Persisting `userSecretKeyShareHex`.** That is application state. Use `localStorage`, IndexedDB (`idb-keyval`), or your own backend.
- **The `QueryClient`.** You own it. The provider does *not* create one.
- **Authentication UI.** The `apiKey` you pass is treated as a per-tree constant. Rotate keys by remounting the provider with a new `options.apiKey`.

## Limitations

- `useSign().mutateAsync(...)` is a one-shot ceremony, not a long-running stream. If you need progress events, fall back to `useMPCKit()` and listen on the underlying `MPCKit.sign` promise plus your own state.
- The provider re-creates the underlying `MPCKit` instance whenever any field of `options` changes referentially; pass a stable `options` object (e.g. via `useMemo`) to avoid churn.
- The eden client is on the same `apiKey`. Mixing API keys for different requests is not supported within one provider.
