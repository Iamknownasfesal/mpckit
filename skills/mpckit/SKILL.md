---
name: mpckit
description: Build with the MPCKit SDKs (@mpckit/sdk for TypeScript, @mpckit/react for React + TanStack Query, and the mpckit crate for Rust). Use when integrating MPCKit hosted MPC signing, onboarding dWallets, producing signatures across Bitcoin / Ethereum / Solana / Sui, or wiring billing and introspection from any of those three languages. Triggers on tasks involving @mpckit/sdk, @mpckit/react, the mpckit Rust crate, the MPCKit class, MPCKit::builder, useMPCKit, useOnboard, useSign, useDWallets, the OnboardArgs / SignArgs types, MPCKit API keys, or the api.mpckit.xyz / api.testnet.mpckit.xyz endpoints.
license: MIT
metadata:
  author: mpckit
  version: "0.3.0"
---

# MPCKit

Build cross-chain signing applications against the MPCKit hosted MPC API. One backend handles every chain that ECDSA secp256k1 / Taproot, Ed25519, ECDSA P-256, or Schnorrkel covers. Three SDKs are first-party.

## When to use

- Calling `api.mpckit.xyz` or `api.testnet.mpckit.xyz` from any language with a published SDK.
- Onboarding a zero-trust dWallet end-to-end (DKG + accept-share) from a 32-byte seed.
- Signing a message with `api.sign(...)` (TypeScript / Rust) or `useSign()` (React).
- Reading `health`, `network`, `protocol-parameters`, billing, or dWallet state.
- Picking the right SDK for a given app shape (Node service, browser, native binary, React UI).

## When NOT to use

- **Self-hosting the backend.** That lives in `apps/backend`; consult `apps/docs/content/docs/self-hosting/**`.
- **Direct upstream `@ika.xyz/sdk` work.** MPCKit re-implements the public surface so consumers never take a transitive `@ika.xyz/sdk` dependency. If the task is about Sui PTBs, Ika coordinator objects, or `IkaTransaction`, use the `ika-sdk` skill instead, not this one.
- **Bitcoin / Solana / Ethereum transaction assembly.** MPCKit produces the raw signature only; broadcasting it to the destination chain is the consumer's responsibility.
- **Move contract authoring against `mpckitcore`.** That is a Move package under `packages/mpckitcore_move`; use the `ika-move` skill.

## Pick by language

| App shape | SDK | Entry point |
|---|---|---|
| Node service, edge function, CLI, tests | `@mpckit/sdk` | `new MPCKit({ apiKey, network })` |
| Browser SPA (Vite, Next, Remix) | `@mpckit/sdk` + `WebWorkerCryptoEngine` OR `@mpckit/react` | `MPCKitProvider` |
| React app with TanStack Query already in tree | `@mpckit/react` | `useMPCKit`, `useOnboard`, `useSign`, ... |
| Rust binary, Tauri backend, async service | `mpckit` crate | `MPCKit::builder().api_key(...).network(...).build()` |

The Rust crate ships with `default = []` features (HTTP only). Add `features = ["crypto"]` to opt into the high-level `onboard` / `sign` ceremonies. Without the `crypto` feature the crate exposes only `sign_prepare` + `sign_submit` and expects the caller to drive the WASM-equivalent centralized signature themselves.

## Hosts and API keys

| Network | Base URL | API key prefix |
|---|---|---|
| Testnet | `https://api.testnet.mpckit.xyz` | `mpckit_test_…` |
| Mainnet | `https://api.mpckit.xyz` | `mpckit_live_…` |

API keys are scoped per network. The base URL is auto-derived from the `Network` enum value if you do not pass `baseUrl` / `.base_url(...)`; override only for self-hosted backends or local development.

Sign-up at `https://app.mpckit.xyz` to issue keys.

## Install

| SDK | Install |
|---|---|
| `@mpckit/sdk` | `bun add @mpckit/sdk` or `pnpm add @mpckit/sdk` |
| `@mpckit/react` | `bun add @mpckit/react @tanstack/react-query` (peer dep). Pulls in `@mpckit/sdk` transitively |
| `mpckit` (Rust) | `cargo add mpckit` then `--features crypto` for the high-level ceremonies |

## At a glance

```ts
import { MPCKit, Curve, Hash, SignatureAlgorithm } from "@mpckit/sdk";
import { randomBytes } from "node:crypto";

const api = new MPCKit({
  apiKey: process.env.MPCKIT_API_KEY!,
  network: "testnet",
});

const seed = randomBytes(32);
const { dwallet, userSecretKeyShareHex } = await api.onboard({
  seed,
  curve: Curve.SECP256K1,
});

const { signature } = await api.sign({
  seed,
  dwalletId: dwallet.id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.SHA256,
  message: new TextEncoder().encode("hello mpckit"),
  userSecretKeyShareHex,
});
```

The `seed` is the only thing you must safeguard between onboard and sign. Anything that derives 32 bytes deterministically works: a passkey PRF output, an env-stored secret, a KMS-released key. The `userSecretKeyShareHex` returned from `onboard()` is the *encrypted* user share; persist it next to the dWallet record so future signs can recover it from your DB.

## Crypto constants

Curves, signature algorithms, and hash schemes are string enums in TypeScript and numeric enums in Rust. Valid combinations:

| Chain | Curve | SignatureAlgorithm | Hash |
|---|---|---|---|
| Ethereum | SECP256K1 | ECDSASecp256k1 | KECCAK256 |
| Bitcoin Taproot | SECP256K1 | Taproot | SHA256 |
| Bitcoin legacy | SECP256K1 | ECDSASecp256k1 | DoubleSHA256 |
| Solana | ED25519 | EdDSA | SHA512 |
| WebAuthn / P-256 | SECP256R1 | ECDSASecp256r1 | SHA256 |
| Polkadot / Substrate | RISTRETTO | SchnorrkelSubstrate | Merlin |

Passing an invalid `(curve, signatureAlgorithm, hashScheme)` triple is rejected by the backend before any crypto runs; the error surfaces as `MPCKitError` with a clear message, not a thrown WASM panic.

## References (load on demand)

| file | when |
| --- | --- |
| [`references/typescript.md`](references/typescript.md) | `@mpckit/sdk` full surface, options, billing, introspection, raw HTTP escape hatch |
| [`references/react.md`](references/react.md) | `MPCKitProvider`, all 10 hooks, worker setup, SSR notes |
| [`references/rust.md`](references/rust.md) | `MPCKit::builder()`, async traits, default vs `crypto` feature, two-phase sign |
| [`references/flows.md`](references/flows.md) | Onboard + sign sequenced for each language; passkey-PRF seed pattern; idempotency |
| [`references/errors.md`](references/errors.md) | `MPCKitError` taxonomy, retry policy, insufficient-credits handling |

## Quick decision flow

1. **What language are you in?** Pick the SDK from the table above.
2. **Do you have an API key?** If not, sign up at `app.mpckit.xyz` and grab one for the right network.
3. **Server-only or browser?** Server / Node: default `InlineCryptoEngine` is fine. Browser: `WebWorkerCryptoEngine` (TS) or `useWorker: true` on `MPCKitProvider` (React). Otherwise the WASM-heavy DKG blocks the main thread for several seconds.
4. **Need a stable signing identity across reloads?** Persist the `seed` somewhere durable (passkey PRF, OS keychain, KMS). `onboard()` returns `userSecretKeyShareHex` and `userPublicOutputHex`; persist both alongside `dwallet.id`.
5. **Onboard once, sign many.** Onboard produces a dWallet. Each subsequent `sign()` is one HTTP roundtrip plus the centralized-signature math. There is no per-request presign management for the consumer; the backend warms a presign pool.

## Common mistakes

| mistake | what to do instead |
| --- | --- |
| Forgetting to persist `userSecretKeyShareHex` after onboard | It is the *only* share-side artifact; without it future signs cannot recover the encrypted user share. The backend never sees it decrypted. |
| Inlining a WASM-heavy crypto engine on the browser main thread | Use `WebWorkerCryptoEngine` (TS) or `useWorker: true` (React). DKG takes 5 to 15 seconds; UI freezes are unacceptable. |
| Sending a private key directly to MPCKit | There is no such endpoint. The flow is DKG-based: the user share is generated on the client during `onboard()`, never extracted. To import an existing key, see `references/flows.md`. |
| Constructing many `MPCKit` instances per request | The instance caches protocol public parameters per curve, so re-creating defeats the cache (and the LRU on the backend warms more slowly). Construct one per process for server use; one per React tree via `MPCKitProvider`. |
| Mixing testnet and mainnet API keys | Keys are scoped per network. Crossing the streams returns a `MPCKitError` with code `auth.network_mismatch`. |
| Treating the `crypto` Rust feature as default | It is opt-in. `default = []` ships HTTP only. Add `features = ["crypto"]` (or `mpckit = { version = "...", features = ["crypto"] }`) when you want `api.onboard(...)` / `api.sign(...)`. |
| Sending the raw signature on-chain without per-chain encoding | MPCKit returns 64-byte Schnorr / 65-byte ECDSA bytes. The destination chain (Solana ed25519, Ethereum 65-byte rsv, Bitcoin DER) imposes its own wrapping. |

## Build verification

After integrating, check that:

- `health()` / `health()`-equivalent returns `{ ok: true }` against the right base URL.
- `networkInfo()` reports the network you expected.
- `balance()` is non-zero (deposit if needed; see `references/flows.md`).
- A small SECP256K1 + ECDSASecp256k1 + SHA256 sign round-trips, returning 65 bytes and a non-null `signature`.

If `sign()` returns but `signature` is zero-length, the dWallet was not yet `Active`; that means `onboard()` did not wait for `acceptUserShare`. Re-run onboard or call `getDwallet()` until `state.kind === "Active"` before signing.
