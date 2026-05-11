/**
 * Public crypto enums. These mirror the upstream `@ika.xyz/sdk`
 * constants but are re-declared here so consumers don't need to take
 * a transitive dependency on `@ika.xyz/sdk`.
 */

export const Curve = {
  SECP256K1: "SECP256K1",
  SECP256R1: "SECP256R1",
  ED25519: "ED25519",
  RISTRETTO: "RISTRETTO",
} as const;
export type Curve = (typeof Curve)[keyof typeof Curve];

export const SignatureAlgorithm = {
  ECDSASecp256k1: "ECDSASecp256k1",
  Taproot: "Taproot",
  ECDSASecp256r1: "ECDSASecp256r1",
  EdDSA: "EdDSA",
  SchnorrkelSubstrate: "SchnorrkelSubstrate",
} as const;
export type SignatureAlgorithm =
  (typeof SignatureAlgorithm)[keyof typeof SignatureAlgorithm];

export const Hash = {
  KECCAK256: "KECCAK256",
  SHA256: "SHA256",
  DoubleSHA256: "DoubleSHA256",
  SHA512: "SHA512",
  Merlin: "Merlin",
} as const;
export type Hash = (typeof Hash)[keyof typeof Hash];

export type Network = "testnet" | "mainnet";
