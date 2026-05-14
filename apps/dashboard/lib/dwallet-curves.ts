/**
 * Sui dWallet curve identifiers. Numeric ids come from the Ika
 * coordinator on Sui; we map them to human-readable labels for display.
 */
export const CURVE_LABELS: Record<number, string> = {
  0: "secp256k1",
  1: "secp256r1",
  2: "ed25519",
  3: "ristretto",
};

export function curveLabel(curve: number): string {
  return CURVE_LABELS[curve] ?? `curve-${curve}`;
}
