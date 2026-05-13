/**
 * Pin the number<->enum mapping in `shared/ika/curves`. The DB persists
 * the wire integer (Move-native) and the SDK consumes the string enum,
 * so a drift here would silently miscategorize signing requests.
 */
import { describe, expect, test } from "bun:test";

import { Curve, SignatureAlgorithm } from "@ika.xyz/sdk";

import {
  curveFromNumber,
  signatureAlgorithmFromNumber,
} from "@/shared/ika/curves";

describe("curveFromNumber", () => {
  test("0 → SECP256K1", () => {
    expect(curveFromNumber(0)).toBe(Curve.SECP256K1);
  });
  test("1 → SECP256R1", () => {
    expect(curveFromNumber(1)).toBe(Curve.SECP256R1);
  });
  test("2 → ED25519", () => {
    expect(curveFromNumber(2)).toBe(Curve.ED25519);
  });
  test("3 → RISTRETTO", () => {
    expect(curveFromNumber(3)).toBe(Curve.RISTRETTO);
  });
  test("rejects unknown curve number", () => {
    expect(() => curveFromNumber(99)).toThrow(/unknown curve number 99/);
  });
});

describe("signatureAlgorithmFromNumber", () => {
  test("SECP256K1 + 0 → ECDSASecp256k1", () => {
    expect(signatureAlgorithmFromNumber(Curve.SECP256K1, 0)).toBe(
      SignatureAlgorithm.ECDSASecp256k1,
    );
  });
  test("SECP256K1 + 1 → Taproot", () => {
    expect(signatureAlgorithmFromNumber(Curve.SECP256K1, 1)).toBe(
      SignatureAlgorithm.Taproot,
    );
  });
  test("SECP256R1 + 0 → ECDSASecp256r1", () => {
    expect(signatureAlgorithmFromNumber(Curve.SECP256R1, 0)).toBe(
      SignatureAlgorithm.ECDSASecp256r1,
    );
  });
  test("ED25519 + 0 → EdDSA", () => {
    expect(signatureAlgorithmFromNumber(Curve.ED25519, 0)).toBe(
      SignatureAlgorithm.EdDSA,
    );
  });
  test("RISTRETTO + 0 → SchnorrkelSubstrate", () => {
    expect(signatureAlgorithmFromNumber(Curve.RISTRETTO, 0)).toBe(
      SignatureAlgorithm.SchnorrkelSubstrate,
    );
  });
  test("rejects an algo that doesn't exist on the curve", () => {
    // Taproot (1) isn't valid on ED25519.
    expect(() => signatureAlgorithmFromNumber(Curve.ED25519, 1)).toThrow(
      /unknown signature algorithm/,
    );
  });
  test("rejects an algo number outside the per-curve table", () => {
    expect(() => signatureAlgorithmFromNumber(Curve.SECP256K1, 9)).toThrow(
      /unknown signature algorithm 9/,
    );
  });
});
