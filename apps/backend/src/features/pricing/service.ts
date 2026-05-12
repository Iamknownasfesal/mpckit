/**
 * Pricing snapshot service.
 *
 * Reads `coordinator::current_pricing()` via the gRPC `simulateTransaction`
 * endpoint, BCS-decodes the return value with our vendored `PricingInfo`
 * struct (in `@mpckit/core`), and caches in an L0 LRU.
 *
 * Refresh: 5 min soft TTL, stale-while-revalidate. Validators vote
 * pricing per epoch, so a stale value served while the background
 * refresh runs is safe.
 *
 * For per-sign quotes we apply env.PRICING_SAFETY_MULTIPLIER on top of
 * the raw IKA/SUI cost so quoted prices absorb intra-epoch movement.
 */
import { PricingInfo } from "@mpckit/core";
import { Transaction } from "@mysten/sui/transactions";
import { env, type IkaNetwork } from "@/config/env";
import {
  assertPricesFresh,
  getIkaCoinType,
  microUsdFromAtomic,
} from "@/features/pricing/price-feed";
import { mutableCache } from "@/shared/cache/l0";
import { errors } from "@/shared/errors";
import { getIkaConfig } from "@/shared/ika/client";
import { getSuiClient } from "@/shared/sui/client";
import { callResilient } from "@/shared/sui/resilience";

/**
 * Protocol flags from coordinator_inner.move. Mirrors what's emitted in
 * `pricing_map[(curve, sigAlgo, protocol)]`.
 */
export const Protocol = {
  DkgFirstRound: 0,
  DkgSecondRound: 1,
  ReEncryptUserShare: 2,
  MakeDwalletShared: 3,
  ImportedKeyVerification: 4,
  Presign: 5,
  Sign: 6,
  FutureSign: 7,
  SignWithPartialSignature: 8,
  DwalletDkg: 9,
  DwalletDkgWithSign: 10,
} as const;
export type Protocol = (typeof Protocol)[keyof typeof Protocol];

export interface PricingValue {
  feeIka: bigint;
  gasFeeReimbursementSui: bigint;
  gasFeeReimbursementSuiForSystemCalls: bigint;
}

export interface PricingKey {
  curve: number;
  signatureAlgorithm: number | null;
  protocol: number;
}

export interface PricingSnapshot {
  byKey: Map<string, PricingValue>;
  entries: Array<{ key: PricingKey; value: PricingValue }>;
  loadedAt: number;
}

const FAMILY = "pricing";

export function pricingKey(
  curve: number,
  signatureAlgorithm: number | null,
  protocol: number,
): string {
  return `${curve}:${signatureAlgorithm ?? "null"}:${protocol}`;
}

async function loadPricing(network: IkaNetwork): Promise<PricingSnapshot> {
  const cfg = getIkaConfig(network);

  const tx = new Transaction();
  tx.moveCall({
    package: cfg.packages.ikaDwallet2pcMpcPackage,
    module: "coordinator",
    function: "current_pricing",
    arguments: [tx.object(cfg.objects.ikaDWalletCoordinator.objectID)],
  });

  // gRPC `simulateTransaction` is the equivalent of the deprecated
  // JSON-RPC `devInspectTransactionBlock`. We need `commandResults` to
  // recover the BCS-encoded return value, and `checksEnabled: false`
  // because `current_pricing` is a non-entry function.
  const sim = await callResilient(
    () =>
      getSuiClient(network).simulateTransaction({
        transaction: tx,
        include: { commandResults: true },
        checksEnabled: false,
      }),
    { name: "simulateTransaction", service: "execution" },
  );

  if (sim.$kind !== "Transaction") {
    throw new Error(
      `pricing: simulateTransaction returned ${sim.$kind} (expected Transaction)`,
    );
  }
  const ret = sim.commandResults?.[0]?.returnValues?.[0];
  if (!ret) {
    throw new Error("pricing: empty return from current_pricing()");
  }
  const info = PricingInfo.parse(ret.bcs);

  const entries: PricingSnapshot["entries"] = [];
  const byKey = new Map<string, PricingValue>();

  // BCS struct field types are erased to `unknown` at compile time;
  // narrow at the boundary before constructing typed values.
  type Entry = {
    key: {
      curve: number;
      signature_algorithm: number | null;
      protocol: number;
    };
    value: {
      fee_ika: string | bigint;
      gas_fee_reimbursement_sui: string | bigint;
      gas_fee_reimbursement_sui_for_system_calls: string | bigint;
    };
  };

  for (const e of info.pricing_map.contents as Entry[]) {
    const key: PricingKey = {
      curve: e.key.curve,
      signatureAlgorithm: e.key.signature_algorithm ?? null,
      protocol: e.key.protocol,
    };
    const value: PricingValue = {
      feeIka: BigInt(e.value.fee_ika),
      gasFeeReimbursementSui: BigInt(e.value.gas_fee_reimbursement_sui),
      gasFeeReimbursementSuiForSystemCalls: BigInt(
        e.value.gas_fee_reimbursement_sui_for_system_calls,
      ),
    };
    entries.push({ key, value });
    byKey.set(
      pricingKey(key.curve, key.signatureAlgorithm, key.protocol),
      value,
    );
  }

  return { byKey, entries, loadedAt: Date.now() };
}

const cache = mutableCache<PricingSnapshot>({
  family: FAMILY,
  ttlMs: 5 * 60 * 1000,
  fetcher: (key: string) => loadPricing(key as IkaNetwork),
  max: 4,
});

export async function getPricing(
  network: IkaNetwork,
): Promise<PricingSnapshot> {
  const v = await cache.fetch(network);
  if (!v) throw new Error("pricing: failed to load");
  return v;
}

export interface SignQuote {
  feeIka: bigint;
  feeSui: bigint;
  /** USD equivalent of feeIka + feeSui at current feed prices, in microUSD. */
  feeMicroUsd: bigint;
  protocols: Array<{ protocol: number; value: PricingValue }>;
}

/**
 * Coin type for the SUI gas-fee leg of every Ika protocol op. The IKA
 * coin type is resolved at boot from the deployed package id and is
 * fetched via `getIkaCoinType()`.
 */
const SUI_TYPE = "0x2::sui::SUI";

/** Total IKA + total SUI cost of one sign (presign + sign). */
export async function quoteSign(
  network: IkaNetwork,
  curve: number,
  signatureAlgorithm: number,
): Promise<SignQuote> {
  // Quoted prices are commitments — fail closed when we can't trust
  // the USD rate rather than serve a stale figure that diverges from
  // what we actually charge at submit time.
  try {
    assertPricesFresh();
  } catch (err) {
    const code =
      (err as { code?: string }).code === "PRICE_FEED_STALE"
        ? "PRICE_FEED_STALE"
        : "PRICE_FEED_UNAVAILABLE";
    throw errors.unavailable(
      err instanceof Error ? err.message : String(err),
      code,
    );
  }
  const snap = await getPricing(network);
  const protocols: Array<{ protocol: number; value: PricingValue }> = [];

  for (const protocol of [Protocol.Presign, Protocol.Sign]) {
    const v = snap.byKey.get(pricingKey(curve, signatureAlgorithm, protocol));
    if (!v) {
      throw new Error(
        `pricing: no entry for (curve=${curve}, sigAlgo=${signatureAlgorithm}, protocol=${protocol})`,
      );
    }
    protocols.push({ protocol, value: v });
  }

  let feeIka = 0n;
  let feeSui = 0n;
  for (const { value } of protocols) {
    feeIka += value.feeIka;
    feeSui +=
      value.gasFeeReimbursementSui + value.gasFeeReimbursementSuiForSystemCalls;
  }

  // Convert raw chain costs to microUSD. SUI is on the feed; IKA is a
  // static price set by the operator until the coin lists.
  const feeMicroUsd = ikaSuiToMicroUsd(feeIka, feeSui);
  return { feeIka, feeSui, feeMicroUsd, protocols };
}

function ikaSuiToMicroUsd(feeIka: bigint, feeSui: bigint): bigint {
  let total = 0n;
  if (feeSui > 0n) {
    total += microUsdFromAtomic(SUI_TYPE, feeSui).microUsd;
  }
  if (feeIka > 0n) {
    const ikaType = getIkaCoinType();
    if (ikaType) total += microUsdFromAtomic(ikaType, feeIka).microUsd;
  }
  return total;
}

/** Apply the operator-configured safety multiplier (round up). */
export function withSafetyMultiplier(x: bigint): bigint {
  const m = env.PRICING_SAFETY_MULTIPLIER;
  if (m === 1) return x;
  return BigInt(Math.ceil(Number(x) * m));
}
