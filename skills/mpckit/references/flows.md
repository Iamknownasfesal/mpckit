# Flows

End-to-end recipes that span more than one SDK call. All three SDKs follow the same shape; this file shows the canonical sequence for each.

## 1. Cold start to signed message (TypeScript)

```ts
import { MPCKit, Curve, Hash, SignatureAlgorithm } from "@mpckit/sdk";
import { randomBytes } from "node:crypto";

const api = new MPCKit({ apiKey, network: "testnet" });

// 1. Health check, prove we can reach the backend.
await api.health();

// 2. Make sure we have credits.
const { balanceMicro } = await api.balance();
if (balanceMicro < 1_000_000n) {
  const addr = await api.depositAddress();
  // ... user sends SUI to addr, you receive the digest ...
  await api.declareDeposit(suiTxDigest);
}

// 3. Onboard.
const seed = randomBytes(32);
const onboarded = await api.onboard({ seed, curve: Curve.SECP256K1 });

// 4. Persist (dwallet.id, userSecretKeyShareHex, userPublicOutputHex, seed-derivation).
await db.dwallets.insert({
  id: onboarded.dwallet.id,
  publicOutputHex: onboarded.userPublicOutputHex,
  encryptedShareHex: onboarded.userSecretKeyShareHex,
});

// 5. Sign.
const { signature } = await api.sign({
  seed,
  dwalletId: onboarded.dwallet.id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.SHA256,
  message: new TextEncoder().encode("hello"),
  userSecretKeyShareHex: onboarded.userSecretKeyShareHex,
});
```

The same sequence in React: `useBalance` + `useDepositAddress` + `useDeclareDeposit` + `useOnboard` + `useSign`. In Rust: `api.balance()` + `api.deposit_address()` + `api.declare_deposit(d)` + `api.onboard(...)` + `api.sign(...)`.

## 2. Browser passkey-PRF seed pattern

The PRF extension on WebAuthn gives you a deterministic 32-byte secret tied to the passkey. That is the right shape for `seed`.

```ts
import { startAuthentication } from "@simplewebauthn/browser";

// Server-prepared options that request the PRF extension.
const options = await fetchPasskeyAuthOptions();
const cred = await startAuthentication({
  optionsJSON: options,
  // ... PRF extension setup omitted for brevity ...
});

// The PRF output is 32 bytes, base64url.
const prfBytes = base64UrlToBytes(cred.clientExtensionResults.prf.results.first);

// Use that as the MPCKit seed. Same passkey, same wallet, forever.
const onboarded = await api.onboard({ seed: prfBytes, curve: Curve.SECP256K1 });
```

Key properties:

- No private-key extraction: the PRF output stays in the WebAuthn ceremony scope.
- Cross-device portability: PRF is per-passkey, so syncing the passkey (iCloud, Google Password Manager) syncs the wallet identity.
- Roaming auth: gate user-side `sign()` calls behind a fresh assertion if your threat model requires it.

The dashboard uses this pattern; see `apps/dashboard/lib/passkey.ts` for the production wiring.

## 3. Onboard once, sign many

There is no per-request presign management at the consumer level. After onboard the dWallet is `Active` and ready; every subsequent `sign()` is one HTTP roundtrip plus the centralized signature math.

```ts
for (const msg of batch) {
  const sig = await api.sign({
    seed,
    dwalletId,
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    hashScheme: Hash.SHA256,
    message: msg,
    userSecretKeyShareHex,
    idempotencyKey: `batch-${msg.id}`,
  });
  // ... broadcast or store ...
}
```

The backend warms a presign pool per network on boot. Tune `BACKEND_PRESIGN_POOL_MIN` in self-hosted deployments if you see latency spikes under burst.

## 4. Retry with idempotency

```ts
async function signWithRetry(args: SignArgs, maxAttempts = 3) {
  const idempotencyKey = newIdempotencyKey(); // pin once, reuse on retry
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await api.sign({ ...args, idempotencyKey });
    } catch (e) {
      if (e instanceof MPCKitTimeoutError) continue;
      throw e;
    }
  }
  throw new Error("sign timed out");
}
```

`MPCKitTimeoutError` is the only safe retry case without further analysis. `MPCKitInsufficientCreditsError` and `MPCKitError` should be surfaced.

## 5. Detecting `Active` after onboard

`onboard()` waits for the dWallet to enter `AwaitingKeyHolderSignature`, sends the accept-share transaction, and returns. In rare cases (slow validator state propagation) the consumer's next `sign()` could race the `Active` flip. If you see `MPCKitError` with code `dwallet.not_active`:

```ts
async function waitForActive(dwalletId: string) {
  while (true) {
    const state = await api.dwalletOnchainState(dwalletId);
    if (state.kind === "Active") return;
    await new Promise((r) => setTimeout(r, 500));
  }
}
```

In React, the same with `useDWallet(id, { refetchInterval: (q) => q.state.data?.state.kind === "Active" ? false : 500 })`.

## 6. Importing an existing key

Out of scope for v1 SDK. The upstream protocol supports zero-trust *imported key* dWallets, and the backend has the route, but the high-level SDK ceremony is not wired yet. Workarounds:

- Use the raw HTTP escape hatch (`api.raw.post("/v1/dwallets/import", { ... })`) plus your own centralized-import-key math.
- Or wait for the next SDK minor that ships `api.importKey({ seed, curve, privateKeyBytes })`.

The Move-level coordinator entry is `coordinator.request_imported_key_dwallet_verification(...)`; see the `ika-move` skill.

## 7. Broadcasting signatures on-chain

MPCKit produces the raw signature bytes; the destination chain wraps them.

| Chain | Wrap |
|---|---|
| Ethereum | 65-byte rsv. MPCKit returns 65 bytes already in `r ‖ s ‖ v`. EIP-191 needs the standard prefix before passing to `hashScheme: KECCAK256`. EIP-712 needs the typed-data digest pre-computed; pass it as `message` with `hashScheme: KECCAK256`. |
| Bitcoin Taproot | 64-byte Schnorr; pass directly into the witness as `[64 bytes]` or `[64 bytes, sighash flag]`. |
| Solana | 64-byte ed25519; pass into `Transaction.signatures[i] = <64 bytes>`. |
| Sui | 64-byte ed25519 (recommended) or 65-byte ECDSA. Combine with the public key into the standard Sui signature scheme byte. |

The MPCKit backend never broadcasts. That separation is intentional: signing and broadcasting have different blast radii.

## 8. Idempotent onboarding

`onboard()` is not idempotent across calls (different seeds make different wallets). To make user onboarding survive retries:

```ts
// 1. Derive the dwallet pubkey from the seed deterministically.
//    Until v1 exposes this helper, you can detect collision by:
const existing = await api.dwallets();
const match = existing.find((d) => /* match by some property */);
if (match) return match;

// 2. Otherwise onboard.
const onboarded = await api.onboard({ seed, curve });
```

Or simpler: track the seed-to-dwallet mapping in your application DB before calling `onboard()`, and only call `onboard()` if the row is absent. The passkey-PRF pattern in section 2 naturally gives this property.

## 9. Self-hosting end-to-end

```ts
const api = new MPCKit({
  apiKey: "mpckit_test_yourselfhosted",
  network: "testnet",
  baseUrl: "https://mpckit.your-domain.dev",
});
```

See `apps/docs/content/docs/self-hosting/index.mdx` for the full backend deployment. The SDK does not change shape when self-hosted; only `baseUrl` differs.
