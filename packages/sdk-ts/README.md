# @mpckit/sdk

TypeScript SDK for [MPCKit](https://mpckit.xyz): hosted MPC signing for
Sui dWallets. One `onboard()` call runs the full zero-trust DKG
ceremony; one `sign()` call returns a signature for Bitcoin, Ethereum,
Solana, or any other curve Ika supports. No MPC node to run.

Live docs: [docs.mpckit.xyz](https://docs.mpckit.xyz).

## Install

```sh
npm install @mpckit/sdk
```

## Quickstart

```ts
import { Curve, Hash, MPCKit, SignatureAlgorithm } from "@mpckit/sdk";
import { randomBytes } from "node:crypto";

const mpckit = new MPCKit({
  apiKey: process.env.MPCKIT_API_KEY!,
  network: "testnet", // or "mainnet"
});

// 1. Onboard. Runs zero-trust DKG end-to-end.
//    `seed` is a 32-byte secret you control (PRF output, KMS-wrapped
//    key, env-stored secret, etc.). Persist `userSecretKeyShareHex`
//    alongside the returned dwallet; you'll need it to sign.
const onboard = await mpckit.onboard({
  seed: randomBytes(32),
  curve: Curve.SECP256K1,
});

console.log(onboard.dwallet.id);
console.log(onboard.userSecretKeyShareHex);

// 2. Sign a message against the dwallet.
const { signature } = await mpckit.sign({
  seed: yourSeed,
  dwalletId: onboard.dwallet.id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.KECCAK256,
  message: yourMessageBytes,
  userSecretKeyShareHex: onboard.userSecretKeyShareHex,
});
```

## Browser apps: keep crypto off the main thread

The default `InlineCryptoEngine` runs WASM signing math synchronously
on the calling thread. For browsers, drop in the worker engine:

```ts
import { MPCKit, createWebWorkerCryptoEngine } from "@mpckit/sdk";

const worker = new Worker(
  new URL("@mpckit/sdk/worker-impl", import.meta.url),
  { type: "module" },
);

const mpckit = new MPCKit({
  apiKey: import.meta.env.VITE_MPCKIT_API_KEY,
  network: "testnet",
  crypto: createWebWorkerCryptoEngine(worker),
});
```

React apps should reach for [`@mpckit/react`](https://www.npmjs.com/package/@mpckit/react)
instead, which wraps this in `<MPCKitProvider useWorker />` and hands
you TanStack Query hooks.

## Subpath exports

- `@mpckit/sdk`: main entry. `MPCKit`, types, errors, curve/hash
  enums.
- `@mpckit/sdk/eden`: typed [Eden](https://elysiajs.com/eden/overview.html)
  client over the backend's Elysia API. Use this when you want raw
  HTTP control with full type inference from the backend's `App` type.
- `@mpckit/sdk/worker-impl`: Web Worker entrypoint for
  `createWebWorkerCryptoEngine`.

## Curve / signature / hash matrix

| Chain         | Curve     | SignatureAlgorithm | Hash         |
| ------------- | --------- | ------------------ | ------------ |
| Ethereum      | SECP256K1 | ECDSASecp256k1     | KECCAK256    |
| Bitcoin       | SECP256K1 | ECDSASecp256k1     | DoubleSHA256 |
| Bitcoin (Taproot) | SECP256K1 | Taproot        | SHA256       |
| Solana        | ED25519   | EdDSA              | SHA512       |
| WebAuthn      | SECP256R1 | ECDSASecp256r1     | SHA256       |
| Substrate     | RISTRETTO | SchnorrkelSubstrate | Merlin      |

## Network selection

Each API key is bound to a Sui network. Issue one per network and
construct one client per network if you need both.

## License

BSD-3-Clause. Source:
[github.com/Iamknownasfesal/mpckit](https://github.com/Iamknownasfesal/mpckit).
