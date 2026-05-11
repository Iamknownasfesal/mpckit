# @mpckit/react

React + TanStack Query bindings for [MpcKit](https://mpckit.xyz). Wraps
[`@mpckit/sdk`](https://www.npmjs.com/package/@mpckit/sdk) in a
Provider and a set of hooks so caching, dedup, and refetch are handled
for you, and the WASM-heavy DKG / sign ceremonies run in a Web Worker
off the main thread.

Live docs: [docs.mpckit.xyz](https://docs.mpckit.xyz).

## Install

```sh
npm install @mpckit/react @mpckit/sdk @tanstack/react-query react
```

`react` (>=18) and `@tanstack/react-query` (>=5) are peer deps. The
consumer owns the `QueryClient`.

## Setup

```tsx
import { MpcKitProvider } from "@mpckit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const qc = new QueryClient();

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MpcKitProvider
        options={{
          apiKey: import.meta.env.VITE_MPCKIT_API_KEY,
          network: "testnet",
        }}
        useWorker
        workerFactory={() =>
          new Worker(
            new URL("@mpckit/sdk/worker-impl", import.meta.url),
            { type: "module" },
          )
        }
      >
        {children}
      </MpcKitProvider>
    </QueryClientProvider>
  );
}
```

`workerFactory` is bundler-specific (Vite, Webpack, Next.js Turbopack
all want different shapes), so the Provider takes a callback rather
than trying to resolve `worker-impl` itself. Leave `useWorker` off for
SSR.

## Hooks

```tsx
import {
  Curve,
  Hash,
  SignatureAlgorithm,
  useBalance,
  useDWallets,
  useOnboard,
  useSign,
} from "@mpckit/react";

function Wallet() {
  const balance = useBalance();
  const dwallets = useDWallets();
  const onboard = useOnboard();
  const sign = useSign();

  return (
    <div>
      <p>Credits: {balance.data?.creditsUsd}</p>
      <p>dWallets: {dwallets.data?.dwallets.length}</p>

      <button
        onClick={() =>
          onboard.mutate({
            seed: crypto.getRandomValues(new Uint8Array(32)),
            curve: Curve.SECP256K1,
          })
        }
      >
        Create dWallet
      </button>

      <button
        onClick={() =>
          sign.mutate({
            seed: yourSeed,
            dwalletId: yourDwalletId,
            curve: Curve.SECP256K1,
            signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
            hashScheme: Hash.KECCAK256,
            message: yourMessageBytes,
            userSecretKeyShareHex: yourPersistedShare,
          })
        }
      >
        Sign
      </button>
    </div>
  );
}
```

Available hooks: `useBalance`, `useBillingHistory`, `useDeclareDeposit`,
`useDepositAddress`, `useDWallet`, `useDWallets`, `useNetworkInfo`,
`useOnboard`, `usePricing`, `useSign`. Mutations invalidate the right
queries automatically (e.g. `useOnboard` invalidates `useDWallets` +
`useBalance` on success).

## Escape hatches

- `useMpcKit()`: the raw `MpcKit` instance, if you need to call
  something the hooks don't cover.
- `useEdenClient()`: the typed Eden treaty client for direct backend
  calls with full type inference from the backend's `App` type.

## License

BSD-3-Clause. Source:
[github.com/Iamknownasfesal/mpckit](https://github.com/Iamknownasfesal/mpckit).
