/**
 * `@mpckit/react` — React bindings over `@mpckit/sdk`.
 *
 * Wraps the imperative `MpcKit` class in a Provider + TanStack Query
 * hooks so React apps get caching, dedup, and refetch for free. The
 * Provider also handles the boilerplate of constructing a Web Worker
 * crypto engine when `useWorker` is on, keeping the WASM-heavy DKG /
 * sign ceremonies off the main thread.
 *
 * Peer deps: `react` (>=18) and `@tanstack/react-query` (>=5). The
 * consumer owns the `QueryClient`.
 */
export { MpcKitProvider, useMpcKit, useEdenClient } from "./provider";
export type { MpcKitProviderProps } from "./provider";
export type { EdenClient, EdenData } from "@mpckit/sdk/eden";

export { useBalance } from "./hooks/use-balance";
export { useBillingHistory } from "./hooks/use-billing-history";
export { useDeclareDeposit } from "./hooks/use-declare-deposit";
export { useDepositAddress } from "./hooks/use-deposit-address";
export { useDWallet } from "./hooks/use-dwallet";
export { useDWallets } from "./hooks/use-dwallets";
export { useNetworkInfo } from "./hooks/use-network-info";
export { useOnboard } from "./hooks/use-onboard";
export { usePricing } from "./hooks/use-pricing";
export { useSign } from "./hooks/use-sign";

export { mpcKitQueryKeys } from "./query-keys";

export { Curve, Hash, SignatureAlgorithm } from "@mpckit/sdk";
export { MPCKIT_HOSTS, defaultBaseUrl } from "@mpckit/sdk";
export {
  MpcKitError,
  MpcKitInsufficientCreditsError,
  MpcKitTimeoutError,
} from "@mpckit/sdk";

export type {
  ApiKey,
  BillingCharge,
  BillingDeposit,
  BillingPricing,
  CryptoEngine,
  DKGOutput,
  DWallet,
  EncryptionKey,
  MpcKitOptions,
  KeySession,
  Network,
  NetworkInfo,
  OnboardArgs,
  OnboardResult,
  SignArgs,
  SignRequest,
  SignResult,
} from "@mpckit/sdk";
