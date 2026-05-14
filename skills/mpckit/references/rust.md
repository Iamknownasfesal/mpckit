# `mpckit` (Rust) reference

Async crate over the MPCKit HTTP surface. Two shapes:

- **default features**: HTTP only. `MPCKit::builder()…build()` plus `health()`, `network_info()`, `protocol_parameters()`, billing, dWallet reads, and the **two-phase** `sign_prepare` / `sign_submit` API. No WASM, no MPC math.
- **`crypto` feature**: adds high-level `onboard(...)` and `sign(...)` ceremonies, the `UserShareEncryptionKeys` type, `prepare_dkg`, and `centralized_sign`. Pulls in fastcrypto + RustCrypto pins.

## Install

```toml
[dependencies]
mpckit = "0.3"

# OR, for the full ceremonies
mpckit = { version = "0.3", features = ["crypto"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

The crate is async via `tokio`. There is no sync surface.

## Construct

```rust
use mpckit::{MPCKit, Network};
use std::time::Duration;

let api = MPCKit::builder()
    .api_key(std::env::var("MPCKIT_API_KEY")?)
    .network(Network::Testnet)        // or Network::Mainnet
    .timeout(Duration::from_secs(30)) // optional, default 30s
    .user_agent("my-app/0.1.0")        // optional
    .base_url("https://api.testnet.mpckit.xyz") // optional override
    .build()?;
```

`Network::Testnet` → `https://api.testnet.mpckit.xyz`. `Network::Mainnet` → `https://api.mpckit.xyz`. Override only for self-hosted backends.

## Introspection (always available)

```rust
let health = api.health().await?;
let info   = api.network_info().await?;
let params = api.protocol_parameters(mpckit::Curve::Secp256k1).await?;
api.invalidate_protocol_parameters_cache().await;
```

The instance caches protocol public parameters per curve. Construct one `MPCKit` per process.

## Billing

```rust
let pricing = api.billing_pricing().await?;
let address = api.deposit_address().await?;
let balance = api.balance().await?;
let _resp   = api.declare_deposit("0xsui_tx_digest").await?;
let history = api.billing_history().await?;
```

## dWallets

```rust
let list = api.list_dwallets().await?;
let dw   = api.get_dwallet("0x...").await?;
let st   = api.dwallet_onchain_state("0x...").await?; // Active | AwaitingKeyHolderSignature | ...
```

## Encryption keys

```rust
// With `crypto` feature on. Requires a 32-byte seed.
use mpckit::UserShareEncryptionKeys;

let keys = UserShareEncryptionKeys::from_seed(&seed, mpckit::Curve::Secp256k1)?;
let resp = api.register_encryption_key(&keys).await?;
```

## High-level onboard (requires `crypto`)

```rust
use mpckit::{OnboardArgs, Curve};

let result = api.onboard(OnboardArgs {
    seed: &seed,                    // &[u8; 32]
    curve: Curve::Secp256k1,
    timeout: None,                  // default 10 min for AwaitingKeyHolderSignature
}).await?;

// result.dwallet                          DWallet record
// result.encryption_key                   row registered for the user
// result.encrypted_user_secret_key_share_id
// result.user_secret_key_share_hex        *** persist next to dwallet.id ***
// result.user_public_output_hex           persist alongside
// result.tx_digests.onboard / .accept
```

## High-level sign (requires `crypto`)

```rust
use mpckit::{SignArgs, Curve, SignatureAlgorithm, Hash};

let result = api.sign(SignArgs {
    seed: &seed,
    dwallet_id: &dwallet_id,
    curve: Curve::Secp256k1,
    signature_algorithm: SignatureAlgorithm::EcdsaSecp256k1,
    hash_scheme: Hash::Sha256,
    message: b"hello mpckit",
    user_secret_key_share_hex: &onboarded.user_secret_key_share_hex,
    idempotency_key: None,    // auto-generated via new_idempotency_key() if omitted
    timeout: None,            // default 3 min E2E
}).await?;

// result.signature        Vec<u8>, 64 or 65 bytes
// result.sign_request_id
// result.sign_session_id
// result.tx_digest        Option<String>
```

The hash is computed inside the SDK; pass the *unhashed* `message` bytes. For prehashed flows, pass the digest as `message` and match `hash_scheme`; the SDK does not double-hash.

## Two-phase sign (HTTP only, no `crypto` feature)

When the `crypto` feature is off you drive the centralized signature yourself.

```rust
let prepared = api.sign_prepare(/* ... */).await?;
// ... your WASM-equivalent centralized signing here ...
let result = api.sign_submit(/* prepared + centralized_signature */).await?;
let req    = api.get_sign_request(&result.sign_request_id).await?;
```

Source: `packages/sdk-rust/src/client.rs`. This is the surface the future "Rust crypto" crate version will plug into without changing call sites.

## Concurrency

`MPCKit` is `Clone + Send + Sync` and uses `reqwest` under the hood with connection pooling. Clone freely across tasks; do **not** wrap in `Arc<Mutex<_>>`.

## Idempotency

```rust
use mpckit::new_idempotency_key;
let key = new_idempotency_key(); // String, UUID v7 in canonical form
```

Pass on `SignArgs.idempotency_key`. Reusing the same key on retry within the server window de-duplicates the charge and the sign.

## Cargo features

| feature | what it adds | when to enable |
|---|---|---|
| `default` | (empty) | HTTP only; you bring your own crypto |
| `crypto` | high-level `onboard` / `sign`, `UserShareEncryptionKeys`, `prepare_dkg`, `centralized_sign` | almost every real consumer |

The `crypto` feature pins `fastcrypto`, `signature`, and friends to RustCrypto pre-releases (the upstream Ika crypto crates are not yet on crates.io). If you hit a version conflict in your workspace, lock those transitive deps via `[patch.crates-io]`.

## Errors

```rust
use mpckit::{Error, ErrorKind};

match err.kind() {
    ErrorKind::Auth => /* bad key, expired, network mismatch */,
    ErrorKind::InsufficientCredits { needed, balance } => /* top up */,
    ErrorKind::Timeout => /* retry with same idempotency key */,
    ErrorKind::Backend { status, code } => /* server-reported error */,
    ErrorKind::Transport(_) => /* network, DNS, TLS */,
    _ => /* unknown */,
}
```

See [`errors.md`](errors.md).

## Examples

See `packages/sdk-rust/examples/` for a hello-world, a passkey-PRF-derived onboard, and an EIP-191 Ethereum signature broadcast end-to-end. They double as integration tests.

## What the Rust SDK does not (yet) handle

- Server-Sent Events / WebSocket subscriptions for sign progress. Add `tokio` task + poll loop on `get_sign_request` if you need progress.
- The Treaty / Eden typed-route client. The TS SDK ships one; the Rust crate does not. Use `reqwest` against the documented HTTP endpoints if you need routes not on `MPCKit`.
- A blocking sync facade. Use `tokio::runtime::Runtime::new()?.block_on(...)` in a non-async caller.
