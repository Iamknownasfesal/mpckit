# Errors

## TypeScript

```ts
import {
  MPCKitError,
  MPCKitInsufficientCreditsError,
  MPCKitTimeoutError,
} from "@mpckit/sdk"; // or "@mpckit/react"
```

Three classes:

- **`MPCKitError`**: base. Every backend-reported failure throws as `MPCKitError` (or a subclass). Carries `.code` (string like `auth.invalid_key`, `dwallet.not_active`, `billing.network_mismatch`) and `.status` (HTTP status). Use the `code` for branching, not the message; messages are humanized and subject to change.
- **`MPCKitInsufficientCreditsError`**: thrown *before* the HTTP request when the locally-known balance is below the price for the operation. Catch this to redirect the user to deposit, not to retry. Carries `.needed` and `.balance` (both `bigint` micro-units).
- **`MPCKitTimeoutError`**: the only safe error to retry without further analysis. Either the HTTP request timed out (`timeoutMs`) or an end-to-end sign / onboard exceeded the per-call timeout. Retries should reuse the same `idempotencyKey`.

Pattern:

```ts
try {
  return await api.sign({ /* ... */, idempotencyKey });
} catch (e) {
  if (e instanceof MPCKitInsufficientCreditsError) {
    routeToDeposit();
    return;
  }
  if (e instanceof MPCKitTimeoutError) {
    return retry({ /* same idempotencyKey */ });
  }
  if (e instanceof MPCKitError) {
    log({ code: e.code, status: e.status, message: e.message });
    throw e;
  }
  throw e; // truly unexpected
}
```

`Error.cause` carries the underlying `fetch` error when the failure is transport-level (DNS, TLS, abort).

## Rust

```rust
use mpckit::{Error, ErrorKind};

match err.kind() {
    ErrorKind::Auth => ...,
    ErrorKind::InsufficientCredits { needed, balance } => ...,
    ErrorKind::Timeout => ...,
    ErrorKind::Backend { status, code } => ...,
    ErrorKind::Transport(_) => ...,
    ErrorKind::Deserialize(_) => ...,
    ErrorKind::Crypto(_) => /* only with `crypto` feature */,
    _ => ...,
}
```

The Rust crate flattens the TS hierarchy into a single `Error` with a `kind()` discriminator. The `code` inside `Backend` mirrors the TS `MPCKitError.code` so dashboards / logs are consistent across languages.

## Common error codes

| code | meaning | typical fix |
|---|---|---|
| `auth.invalid_key` | API key not recognised | rotate or check `apiKey` |
| `auth.network_mismatch` | testnet key against mainnet host (or vice versa) | match `network` to the key prefix |
| `auth.revoked` | key was deleted in the dashboard | issue a new key |
| `billing.insufficient_credits` | balance lower than price | deposit; see `flows.md` section 1 |
| `billing.no_deposit_for_digest` | `declareDeposit` digest does not match an inbound tx | wait a few seconds; the indexer may be behind |
| `dwallet.not_active` | dWallet still in `AwaitingKeyHolderSignature` or earlier | poll `dwalletOnchainState` until `Active`; see `flows.md` section 5 |
| `dwallet.not_found` | wrong id, or the dWallet was deleted | verify against `api.dwallets()` |
| `sign.invalid_combination` | curve / signatureAlgorithm / hashScheme triple is not valid | see the table in `SKILL.md` |
| `sign.idempotency_conflict` | same `idempotencyKey` was used with different args | generate a new key, or send the original args |
| `protocol.parameters_stale` | reconfiguration happened mid-flight | call `invalidateProtocolParametersCache()` and retry |
| `rate_limit.exceeded` | per-key request rate exceeded | back off; the `Retry-After` header indicates seconds |

## Retry policy

| error | safe to retry without re-deriving? | reuse `idempotencyKey`? |
|---|---|---|
| `MPCKitTimeoutError` | yes | yes (required to avoid double-charge) |
| `rate_limit.exceeded` | yes, after `Retry-After` | yes |
| `protocol.parameters_stale` | yes, after `invalidateProtocolParametersCache()` | yes |
| transport-level (`fetch` rejected) | yes, with jittered backoff | yes |
| `MPCKitInsufficientCreditsError` | no, fund first | n/a |
| `dwallet.not_active` | yes, after polling state | yes |
| anything else | no, investigate | depends |

## Production logging

The `code` and `status` carry the actionable signal. The message is for humans:

```ts
function logMpcKitError(e: MPCKitError) {
  pino.error({
    err: { name: e.name, code: e.code, status: e.status },
    msg: e.message,
  });
}
```

Avoid logging the raw `MPCKitError` object directly; some fields hold request-shape data that you may not want in your structured logs.

## Tests

For unit tests, construct an `MPCKit` instance with a fake `fetch` and throw the typed errors directly. The backend's `code` strings are stable across patch releases.
