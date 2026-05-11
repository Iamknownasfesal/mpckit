/**
 * Vendored BCS layouts for Ika coordinator state we read directly.
 *
 * `@ika.xyz/sdk` doesn't expose its `generated/ika_dwallet_2pc_mpc`
 * submodules through its package `exports` map, so we duplicate the
 * tiny set of structs we actually need. Source of truth:
 *   https://github.com/dwallet-labs/ika
 *   contracts/ika_dwallet_2pc_mpc/sources/pricing.move
 *
 * If the upstream layout changes, regenerate from the Move source.
 */
import { type BcsType, bcs } from "@mysten/sui/bcs";

const VecMap = <K, V>(key: BcsType<K>, value: BcsType<V>) =>
  bcs.struct("VecMap", {
    contents: bcs.vector(
      bcs.struct("Entry", {
        key,
        value,
      }),
    ),
  });

export const PricingInfoKey = bcs.struct("PricingInfoKey", {
  curve: bcs.u32(),
  signature_algorithm: bcs.option(bcs.u32()),
  protocol: bcs.u32(),
});

export const PricingInfoValue = bcs.struct("PricingInfoValue", {
  fee_ika: bcs.u64(),
  gas_fee_reimbursement_sui: bcs.u64(),
  gas_fee_reimbursement_sui_for_system_calls: bcs.u64(),
});

export const PricingInfo = bcs.struct("PricingInfo", {
  pricing_map: VecMap(PricingInfoKey, PricingInfoValue),
});

export type PricingInfoT = ReturnType<typeof PricingInfo.parse>;
export type PricingInfoKeyT = ReturnType<typeof PricingInfoKey.parse>;
export type PricingInfoValueT = ReturnType<typeof PricingInfoValue.parse>;
