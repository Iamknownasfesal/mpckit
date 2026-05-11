/**
 * Local number<->string mapping for Curve / SignatureAlgorithm. The
 * SDK has these helpers internally but does not re-export them from
 * the package root. We persist DB rows as numbers (Move/coordinator
 * native) and cross to strings only when calling the SDK.
 */
import { Curve, SignatureAlgorithm } from "@ika.xyz/sdk";

const CURVE_BY_NUMBER: Record<number, Curve> = {
  0: Curve.SECP256K1,
  1: Curve.SECP256R1,
  2: Curve.ED25519,
  3: Curve.RISTRETTO,
};

const SIG_ALGO_BY_CURVE_NUMBER: Record<
  Curve,
  Record<number, SignatureAlgorithm>
> = {
  [Curve.SECP256K1]: {
    0: SignatureAlgorithm.ECDSASecp256k1,
    1: SignatureAlgorithm.Taproot,
  },
  [Curve.SECP256R1]: {
    0: SignatureAlgorithm.ECDSASecp256r1,
  },
  [Curve.ED25519]: {
    0: SignatureAlgorithm.EdDSA,
  },
  [Curve.RISTRETTO]: {
    0: SignatureAlgorithm.SchnorrkelSubstrate,
  },
};

export function curveFromNumber(n: number): Curve {
  const c = CURVE_BY_NUMBER[n];
  if (!c) throw new Error(`unknown curve number ${n}`);
  return c;
}

export function signatureAlgorithmFromNumber(
  curve: Curve,
  n: number,
): SignatureAlgorithm {
  const algo = SIG_ALGO_BY_CURVE_NUMBER[curve]?.[n];
  if (!algo) {
    throw new Error(`unknown signature algorithm ${n} for curve ${curve}`);
  }
  return algo;
}
