/**
 * `@mpckit/sdk` — TypeScript SDK for MpcKit.
 *
 * Single class `MpcKit` exposes:
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
export { MpcKit, MPCKIT_HOSTS, defaultBaseUrl } from "./api";
export type {
  MpcKitOptions,
  OnboardArgs,
  OnboardResult,
  SignArgs,
  SignResult,
} from "./api";

export {
  MpcKitError,
  MpcKitInsufficientCreditsError,
  MpcKitTimeoutError,
} from "./errors";

export { Curve, Hash, SignatureAlgorithm } from "./constants";
export type { Network } from "./constants";

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

export type { CryptoEngine, KeySession, DKGOutput } from "./crypto/engine";
export { InlineCryptoEngine, inlineCryptoEngine } from "./crypto/inline";
export {
  WebWorkerCryptoEngine,
  createWebWorkerCryptoEngine,
} from "./crypto/web-worker";
