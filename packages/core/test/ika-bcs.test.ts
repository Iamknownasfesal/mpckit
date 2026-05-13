/**
 * Round-trip tests for the vendored BCS layouts. These structs are the
 * wire format for `mpckitcore`'s on-chain pricing reads — if the layout
 * here drifts from upstream Move, every pricing query silently breaks.
 */
import { describe, expect, test } from "bun:test";

import { PricingInfo, PricingInfoKey, PricingInfoValue } from "../src/ika-bcs";

describe("PricingInfoKey", () => {
  test("round-trips with signature_algorithm set", () => {
    const key = { curve: 0, signature_algorithm: 1, protocol: 2 };
    const bytes = PricingInfoKey.serialize(key).toBytes();
    const parsed = PricingInfoKey.parse(bytes);
    expect(parsed.curve).toBe(0);
    expect(parsed.signature_algorithm).toBe(1);
    expect(parsed.protocol).toBe(2);
  });

  test("round-trips with signature_algorithm = None", () => {
    const key = { curve: 2, signature_algorithm: null, protocol: 4 };
    const bytes = PricingInfoKey.serialize(key).toBytes();
    const parsed = PricingInfoKey.parse(bytes);
    expect(parsed.signature_algorithm).toBeNull();
    expect(parsed.protocol).toBe(4);
  });
});

describe("PricingInfoValue", () => {
  test("round-trips u64 fields as decimal strings", () => {
    // Mysten BCS serializes u64 from string|number|bigint and parses back
    // as a string by default.
    const v = {
      fee_ika: "1000",
      gas_fee_reimbursement_sui: "2000",
      gas_fee_reimbursement_sui_for_system_calls: "3000",
    };
    const bytes = PricingInfoValue.serialize(v).toBytes();
    const parsed = PricingInfoValue.parse(bytes);
    expect(parsed.fee_ika).toBe("1000");
    expect(parsed.gas_fee_reimbursement_sui).toBe("2000");
    expect(parsed.gas_fee_reimbursement_sui_for_system_calls).toBe("3000");
  });

  test("accepts bigint + number on the serialize side", () => {
    const v = {
      fee_ika: 1n,
      gas_fee_reimbursement_sui: 2,
      gas_fee_reimbursement_sui_for_system_calls: "3",
    };
    const bytes = PricingInfoValue.serialize(v).toBytes();
    const parsed = PricingInfoValue.parse(bytes);
    expect(parsed.fee_ika).toBe("1");
    expect(parsed.gas_fee_reimbursement_sui).toBe("2");
    expect(parsed.gas_fee_reimbursement_sui_for_system_calls).toBe("3");
  });
});

describe("PricingInfo", () => {
  test("encodes an empty pricing_map", () => {
    const empty = { pricing_map: { contents: [] } };
    const bytes = PricingInfo.serialize(empty).toBytes();
    const parsed = PricingInfo.parse(bytes);
    expect(parsed.pricing_map.contents.length).toBe(0);
  });

  test("encodes a single entry with curve+algo+protocol distinguishing the key", () => {
    const sample = {
      pricing_map: {
        contents: [
          {
            key: { curve: 0, signature_algorithm: 0, protocol: 0 },
            value: {
              fee_ika: "5",
              gas_fee_reimbursement_sui: "6",
              gas_fee_reimbursement_sui_for_system_calls: "7",
            },
          },
        ],
      },
    };
    const bytes = PricingInfo.serialize(sample).toBytes();
    const parsed = PricingInfo.parse(bytes);
    expect(parsed.pricing_map.contents.length).toBe(1);
    const entry = parsed.pricing_map.contents[0]!;
    expect(entry.key.curve).toBe(0);
    expect(entry.key.signature_algorithm).toBe(0);
    expect(entry.key.protocol).toBe(0);
    expect(entry.value.fee_ika).toBe("5");
  });

  test("preserves entry order across serialize/parse", () => {
    const entries = [
      { curve: 0, signature_algorithm: 0, protocol: 0 },
      { curve: 0, signature_algorithm: 1, protocol: 0 },
      { curve: 2, signature_algorithm: 0, protocol: 0 },
    ];
    const sample = {
      pricing_map: {
        contents: entries.map((key, i) => ({
          key,
          value: {
            fee_ika: String(i * 100),
            gas_fee_reimbursement_sui: "0",
            gas_fee_reimbursement_sui_for_system_calls: "0",
          },
        })),
      },
    };
    const bytes = PricingInfo.serialize(sample).toBytes();
    const parsed = PricingInfo.parse(bytes);
    expect(parsed.pricing_map.contents.map((e) => e.key.curve)).toEqual([
      0, 0, 2,
    ]);
    expect(
      parsed.pricing_map.contents.map((e) => e.key.signature_algorithm),
    ).toEqual([0, 1, 0]);
    expect(parsed.pricing_map.contents.map((e) => e.value.fee_ika)).toEqual([
      "0",
      "100",
      "200",
    ]);
  });
});
