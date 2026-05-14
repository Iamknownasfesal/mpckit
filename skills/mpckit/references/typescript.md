# `@mpckit/sdk` reference

Single class, full surface. Works in Node (`>=18`), Bun, Deno, and modern browsers. ESM only.

## Install

```bash
bun add @mpckit/sdk
# or
pnpm add @mpckit/sdk
```

## Construct

```ts
import { MPCKit } from "@mpckit/sdk";

const api = new MPCKit({
  apiKey: process.env.MPCKIT_API_KEY!, // mpckit_test_… or mpckit_live_…
  network: "testnet",                  // "testnet" | "mainnet"
  // Optional. Defaults to api.testnet.mpckit.xyz / api.mpckit.xyz
  baseUrl: "https://api.testnet.mpckit.xyz",
  // Optional. Defaults to the Mysten public fullnode for the chosen network
  suiRpcUrl: "https://fullnode.testnet.sui.io:443",
  // Optional. Defaults to InlineCryptoEngine
  crypto: undefined,
  // Optional. Per-request HTTP timeout, defaults to 30s
  timeoutMs: 30_000,
  // Optional. Injected for tests, custom retry, edge-runtime fetch wrappers
  fetch: undefined,
});
```

`MPCKitOptions` source: `packages/sdk-ts/src/api.ts`.

## Introspection

```ts
await api.health();      // { ok, service, uptime, now }
await api.networkInfo(); // current network, package id, coordinator id, ...
await api.protocolParameters(Curve.SECP256K1); // Uint8Array, cached on instance
api.invalidateProtocolParametersCache();        // call after RECONFIGURATION
```

`protocolParameters()` is what the SDK uses internally for the centralized signature math. Going through MPCKit is ~50 ms vs ~11 s cold against the Sui fullnode chunked table-vec; do not bypass it.

## Onboard (DKG end-to-end)

```ts
import { Curve } from "@mpckit/sdk";
import { randomBytes } from "node:crypto";

const seed = randomBytes(32);

const onboarded = await api.onboard({
  seed,
  curve: Curve.SECP256K1,
  timeoutMs: 600_000, // optional, default 10 min for AwaitingKeyHolderSignature
});

// onboarded.dwallet                          DWallet record
// onboarded.encryptionKey                    EncryptionKey row registered for the user
// onboarded.encryptedUserSecretKeyShareId    used internally for subsequent sign calls
// onboarded.userSecretKeyShareHex            *** persist next to dwallet.id ***
// onboarded.userPublicOutputHex              persist alongside, used to derive addresses
// onboarded.txDigests.onboard / .accept      Sui transaction digests
```

The 32-byte seed is the user-side root of trust. Anything deterministic works: a passkey PRF output, a KMS-released secret, `randomBytes(32)` for ephemeral test wallets. Reuse the *same* seed for `sign()` calls on the same dWallet.

`userSecretKeyShareHex` is the encrypted user share. Without it the dWallet is unsignable. Persist it next to `dwallet.id` in your DB.

## Sign

```ts
import { Hash, SignatureAlgorithm } from "@mpckit/sdk";

const result = await api.sign({
  seed,                                      // SAME seed used at onboard
  dwalletId: onboarded.dwallet.id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.SHA256,
  message: new TextEncoder().encode("hello mpckit"),
  userSecretKeyShareHex: onboarded.userSecretKeyShareHex,
  idempotencyKey: "purchase-1234",           // optional, auto-generated otherwise
  timeoutMs: 180_000,                        // optional, default 3 min E2E
});

result.signature       // Uint8Array, 64 or 65 bytes depending on algo
result.signRequestId   // server-side sign request UUID
result.signSessionId   // upstream Ika sign session
result.txDigest        // Sui digest of the on-chain CommitSignature (or null on certain flows)
```

The hash is computed inside the SDK; pass the *unhashed* `message` bytes. For prehashed flows (Bitcoin sighash, EVM EIP-712 digest already computed), encode the digest as the `message` and pick the matching `hashScheme`; the SDK will not double-hash.

Idempotency: passing the same `idempotencyKey` on retry within the request window de-duplicates server-side. Omit only if you can tolerate duplicate signature charges on flaky networks.

## Billing

```ts
await api.balance();              // { currency, balanceMicro, ... }
await api.pricing();              // { signMicro, onboardMicro, minDepositMicro }
await api.depositAddress();       // Sui address for credit deposits
await api.declareDeposit(digest); // notify backend of an inbound Sui tx
await api.billingHistory();       // recent charges + deposits
```

Charges are taken on success; `MPCKitInsufficientCreditsError` throws before any crypto runs if `balance < pricing.signMicro`.

## dWallets

```ts
await api.dwallets();                   // [{ id, network, kind, state, ... }]
await api.dwallet(dwalletId);           // single record
await api.dwalletOnchainState(dwalletId); // Sui state: Active | AwaitingKeyHolderSignature | ...
```

## Encryption keys

```ts
await api.encryptionKeys();
await api.registerEncryptionKey({ seed, curve: Curve.SECP256K1 });
```

`onboard()` calls `registerEncryptionKey()` internally for new users. You only need the explicit call if you are wiring a custom flow (e.g. importing an existing dWallet under a new user identity).

## Crypto engines

```ts
import {
  InlineCryptoEngine,
  inlineCryptoEngine,
  createWebWorkerCryptoEngine,
  WebWorkerCryptoEngine,
} from "@mpckit/sdk";
```

- `inlineCryptoEngine` (singleton) is the default. Fine for Node, Bun, server-side.
- `WebWorkerCryptoEngine` keeps WASM ceremonies off the browser main thread. Construct with `createWebWorkerCryptoEngine(workerFactory)`:

```ts
const engine = createWebWorkerCryptoEngine(
  () =>
    new Worker(new URL("@mpckit/sdk/worker-impl", import.meta.url), {
      type: "module",
    }),
);
const api = new MPCKit({ apiKey, network, crypto: engine });
```

Worker factory shape varies by bundler. Vite + Next.js Turbopack accept the `new URL(...)` pattern above; Webpack needs `worker-loader` or `new Worker(url, { type: "module" })`. The factory is invoked once at engine creation; the worker lives for the engine's lifetime.

## Raw HTTP escape hatch

```ts
api.raw.get<{ ok: boolean }>("/v1/some-internal-endpoint");
api.raw.post("/v1/something", { body: { ... } });
```

`api.raw` is the underlying `HttpClient`. Use only for endpoints not yet typed on the `MPCKit` class. Anything stable should move to a typed wrapper.

## Utilities

```ts
import {
  fromHex,
  toHex,
  newIdempotencyKey,
  randomSessionIdentifier,
} from "@mpckit/sdk";
```

- `fromHex(s)` / `toHex(bytes)`: hex round-trip; tolerant of `0x` prefix.
- `newIdempotencyKey()`: a stable UUID v7 suitable for `SignArgs.idempotencyKey`.
- `randomSessionIdentifier()`: 32-byte session id; only needed for the low-level prepare/submit flow.

## Errors

See [`errors.md`](errors.md). Three exports: `MPCKitError` (base), `MPCKitInsufficientCreditsError` (charge would overdraw), `MPCKitTimeoutError` (E2E sign / onboard timeout).

## Bundler notes

- `@mpckit/sdk` is ESM only. CommonJS consumers must use dynamic `await import("@mpckit/sdk")`.
- The worker entry is exported as `@mpckit/sdk/worker-impl` so bundlers can resolve it without a relative path.
- `@mpckit/sdk/eden` exports a typed Treaty client over the backend; do not confuse it with `api.raw`. Use `eden` when you want client-side typing of routes that are not on the `MPCKit` class.
