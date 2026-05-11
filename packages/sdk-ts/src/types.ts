/**
 * Public types mirroring the backend's JSON response shapes. We keep
 * these in lockstep with `apps/backend/src/features/<x>/routes.ts`;
 * mismatches surface as compile errors here when you regenerate.
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface EncryptionKey {
  id: string;
  curve: number;
  suiObjectId: string;
  suiAddress: string;
  suiTxDigest: string;
  createdAt?: string;
}

export interface DWallet {
  id: string;
  accountId: string | null;
  suiDwalletId: string;
  curve: number;
  kind: "zero_trust" | "shared";
  status: "submitting" | "awaiting_user_share" | "active" | "failed";
  encryptionKeyId: string;
  dkgTxDigest: string | null;
  acceptTxDigest: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignRequest {
  id: string;
  status: "queued" | "submitted" | "completed" | "failed";
  txDigest: string | null;
  signSessionId: string | null;
  signatureHex: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BillingDeposit {
  id: string;
  txDigest: string;
  senderAddress: string;
  coinType: string;
  amountAtomic: string;
  /** microUSD credited (1 microUSD = $0.000001). */
  creditsMicro: string;
  /** Same as `creditsMicro` rendered as a USD string, e.g. "1.234567". */
  creditsUsd: string;
  sweepStatus: "pending" | "swept" | "failed";
  sweepTxDigest: string | null;
  createdAt: string;
  sweptAt: string | null;
}

export interface BillingCharge {
  id: string;
  opType: string;
  opId: string;
  kind: "charge" | "refund";
  /** Signed microUSD: charges are negative, refunds positive. */
  creditsMicro: string;
  /** Same as `creditsMicro` rendered as a USD string. */
  creditsUsd: string;
  reason: string | null;
  createdAt: string;
}

export interface BillingPricing {
  /** Always "microUSD" — 1 microUSD = $0.000001. */
  unit: "microUSD";
  /** microUSD per 1 USD; always 1_000_000. */
  microPerUsd: number;
  /** Op prices in microUSD. */
  ops: Record<string, number>;
  /** Op prices rendered as USD strings ("0.010000"). */
  opsUsd: Record<string, string>;
  acceptedCoinTypes: string[];
  minDepositMicro: number;
  minDepositUsd: string;
  /** Live USD prices per accepted coin (microUSD per 1 whole coin). */
  coinPricesUsd: Record<string, string>;
  priceFeed: {
    /** "feed" | "fallback" | "mixed" — see backend price-feed.ts. */
    source: string;
    /** Wall-clock ms when the snapshot was assembled (any source). */
    loadedAt: number;
    /** Wall-clock ms of the most recent successful CoinGecko poll. */
    lastFeedSuccessAt: number;
    /** True when the most recent feed success is older than the
     *  operator's max-age budget. Paid endpoints reject when stale;
     *  this read endpoint surfaces the flag for SDKs to display. */
    stale: boolean;
  };
}

export interface NetworkInfo {
  /** Sui address that will submit DKG/sign PTBs; DKG message is bound to it. */
  operatorAddress: string;
  packages: { ikaPackage: string; ikaDwallet2pcMpcPackage: string };
  objects: { coordinator: string; system: string };
  latestEncryptionKey: { id: string; epoch: number; loadedAt: number };
}
