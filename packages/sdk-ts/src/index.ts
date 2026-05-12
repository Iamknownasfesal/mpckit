/**
 * `@mpckit/sdk` — TypeScript SDK for MPCKit.
 *
 * Single class `MPCKit` exposes:
 *
 *   - HTTP introspection (`health`, `networkInfo`)
 *   - Billing (`balance`, `depositAddress`, `declareDeposit`, ...)
 *   - End-to-end ceremonies (`onboard`, `sign`) with all crypto handled
 *     internally; consumers never import `@ika.xyz/sdk` directly
 *   - Raw HTTP escape hatch via `api.raw.get/post/delete(...)`
 *
 * Heavy crypto (DKG prep, centralized signature) runs through a
 * `CryptoEngine` boundary. The default `InlineCryptoEngine` runs on
 * the calling thread; for browser apps, swap in a `WebWorkerCryptoEngine`
 * (sibling export, ships separately) to keep the main thread responsive.
 */

export type {
  MPCKitOptions,
  OnboardArgs,
  OnboardResult,
  SignArgs,
  SignResult,
} from "./api";
export { defaultBaseUrl, MPCKIT_HOSTS, MPCKit } from "./api";
export type { Network } from "./constants";

export { Curve, Hash, SignatureAlgorithm } from "./constants";
export type { CryptoEngine, DKGOutput, KeySession } from "./crypto/engine";
export { InlineCryptoEngine, inlineCryptoEngine } from "./crypto/inline";
export {
  createWebWorkerCryptoEngine,
  WebWorkerCryptoEngine,
} from "./crypto/web-worker";
export {
  MPCKitError,
  MPCKitInsufficientCreditsError,
  MPCKitTimeoutError,
} from "./errors";
export type {
  ApiKey,
  BillingCharge,
  BillingDeposit,
  BillingPricing,
  DWallet,
  EncryptionKey,
  NetworkInfo,
  SignRequest,
  User,
} from "./types";
export {
  fromHex,
  newIdempotencyKey,
  randomSessionIdentifier,
  toHex,
} from "./util";
