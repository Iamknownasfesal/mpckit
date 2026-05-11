# MpcKit

**Hosted MPC signing for Sui dWallets. Sign on every chain from one API.**

MpcKit is a gateway that runs Ika dWallets on behalf of users who don't
want to hold a Sui account. The operator pays IKA + SUI fees and runs
the presign pool; users keep their encryption identity client-side and
pay the operator a service fee. The dWallet itself is zero-trust: the
operator never holds the user's share.

A single backend serves both Sui networks (testnet + mainnet) side by
side; the dashboard pivots via an `x-network` header. Drop either
network's env block to disable it cleanly.

[**mpckit.xyz**](https://mpckit.xyz) · [Dashboard](https://app.mpckit.xyz) · [Docs](https://docs.mpckit.xyz) · [API](https://api.mpckit.xyz/v1/network)

## What you can do with it

- **Sign on every chain from one bearer token.** Solana (Ed25519),
  Ethereum (secp256k1 ECDSA), Bitcoin (secp256k1 Taproot or legacy
  ECDSA), Substrate (Ristretto Schnorrkel), and any WebAuthn-flavoured
  P-256 use case.
- **Zero-trust dWallets.** Encryption identity lives client-side
  (derived from a passkey PRF, a deterministic seed, or whatever you
  hand the SDK). The operator can't sign without you.
- **Multi-network, one stack.** Same SDK, same API key prefix
  (`mpckit_test_…` / `mpckit_live_…`), `x-network` toggles which chain
  the call resolves against.
- **Self-hostable.** The hosted product at api.mpckit.xyz is one
  tenant of this exact code. `docker compose up` boots the whole
  stack.

## SDK quickstart

```ts
import { MpcKit } from "@mpckit/sdk";

const client = new MpcKit({
  baseUrl: "https://api.mpckit.xyz",
  apiKey: process.env.MPCKIT_API_KEY!, // mpckit_test_... or mpckit_live_...
});

// 1. enroll an encryption identity on a curve (one-shot per device).
const enc = await client.onboardEncryptionKey({ curve: "ed25519" });

// 2. mint a dWallet on Solana's curve.
const dw = await client.onboardDWallet({ encryptionKeyId: enc.id });

// 3. sign a Solana tx.
const sig = await client.sign({
  dwalletId: dw.id,
  message: solanaTxBytes,
  hashScheme: "sha512",
});
```

Full reference + recipes: [docs.mpckit.xyz](https://docs.mpckit.xyz).

**Install:**

```sh
# TypeScript
npm install @mpckit/sdk            # or pnpm/bun/yarn
npm install @mpckit/react          # optional, TanStack Query bindings
```

**Rust:** the `mpckit` crate is a git dep until the `crypto` feature
gets split into a separate crate (its git-based MPC forks block a
crates.io publish):

```toml
[dependencies]
mpckit = { git = "https://github.com/Iamknownasfesal/mpckit", tag = "v0.2.0" }
# Add `features = ["crypto"]` if you want the bundled DKG / sign
# ceremonies; the default build is HTTP-only.
```

## Self-host

Single host, `docker compose up`:

```sh
git clone https://github.com/Iamknownasfesal/mpckit
cd mpckit
cp .env.example .env   # fill in the per-network blocks you want
docker compose up -d
```

Production deployments (Kubernetes + Hetzner / GKE / etc.) use the
manifests in [`infra/k8s/`](./infra/k8s/); see the
[self-hosting guide](https://docs.mpckit.xyz/docs/self-hosting) for the
end-to-end setup. CI builds and pushes
`ghcr.io/iamknownasfesal/mpckit-{backend,dashboard,docs}` on every tag.

## Architecture (one paragraph)

The backend is a Bun + Elysia HTTP server backed by Postgres (accounts,
audit, billing, presign-pool mirror), Redis (rate limits, idempotency,
distributed lock around the operator hot wallet), and a `sui-gas-pool`
sidecar per chain that sponsors gas for every PTB. Every Sui-touching
service in the backend reads its target network from
`requestNetwork(request)` so one process can serve testnet and
mainnet concurrently; gas-station, IkaClient, package IDs, and the
hot-wallet submission path are all keyed by network internally.

## Layout

```
apps/backend                 Bun + Elysia gateway (HTTP + worker)
apps/dashboard               Next.js dashboard (app.mpckit.xyz)
apps/docs                    Fumadocs site (mpckit.xyz + docs.mpckit.xyz)
packages/core                @mpckit/core: shared types + BCS schemas
packages/sdk-ts              @mpckit/sdk: TypeScript SDK
packages/sdk-react           @mpckit/react: TanStack Query bindings
packages/sdk-rust            mpckit crate: Rust SDK (`crypto` feature for ceremonies)
packages/mpckitcore_move     on-chain Move package (treasury + caps)
examples/ts-node             Node SDK demo
examples/ts-browser          Vite + browser SDK demo
examples/rust-cli            Rust SDK onboard + sign demo
infra/gas-station            Dockerfile + entrypoint for the sui-gas-pool sidecar
infra/k8s                    Kustomize base + overlays for k8s deploys
```

## Tech

- **Bun** runtime; **Elysia** HTTP.
- **Postgres** (Drizzle) for accounts, audit, billing, presign mirror.
- **Redis** (ioredis) for rate limits, idempotency, tx submission lock.
- **`@mysten/sui` v2.16+ gRPC client** for Sui transport.
- **`@ika.xyz/sdk`** for Ika dWallet reads + tx builders.
- **`@simplewebauthn/server`** + **Better-Auth** for dashboard auth.
- **Prometheus** (`prom-client`) + **`pino`** for metrics + structured logs.

## Status

`v0.2.0`: live on Sui testnet and mainnet at
[api.mpckit.xyz](https://api.mpckit.xyz/v1/network). One backend serves
both networks; `x-network` toggles per request.

## Author + license

Built by [fesal](https://github.com/Iamknownasfesal). BSD-3-Clause;
see [`LICENSE`](./LICENSE). Hosted product is one deployment of this
exact code; fork or self-host freely.
