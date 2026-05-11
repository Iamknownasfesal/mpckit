/**
 * Deterministic per-user Sui keypair derivation. The master seed is
 * a long-lived environment secret; per-user keys are HKDF-expanded
 * from it on demand and never persisted.
 *
 * Recipe:
 *   HKDF-Extract: salt = "ika-api/billing/v1", IKM = master seed
 *   HKDF-Expand: info = "deposit:" || userId, length = 32 bytes
 *   secretKey = the 32 bytes
 *   keypair  = Ed25519Keypair.fromSecretKey(secretKey)
 *
 * The keypair has the same shape the operator hot wallet uses, so we
 * can pass it directly to anything that wants a Signer.
 */
import { hkdfSync } from "node:crypto";
import { env } from "@/config/env";
import { errors } from "@/shared/errors";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const HKDF_SALT = Buffer.from("ika-api/billing/v1", "utf8");

function masterSeed(): Buffer {
  const hex = env.BILLING_DEPOSIT_MASTER_SEED_HEX;
  if (!hex) throw errors.notConfigured("billing deposit master seed");
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]+$/.test(stripped)) {
    throw errors.notConfigured(
      "BILLING_DEPOSIT_MASTER_SEED_HEX must be 32 bytes hex",
    );
  }
  return Buffer.from(stripped, "hex");
}

export function deriveDepositKeypair(
  userId: string,
  network: string,
): Ed25519Keypair {
  const info = Buffer.from(`deposit:${network}:${userId}`, "utf8");
  const okm = hkdfSync("sha256", masterSeed(), HKDF_SALT, info, 32);
  const secretKey = new Uint8Array(okm as ArrayBuffer);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

export function deriveDepositAddress(userId: string, network: string): string {
  return deriveDepositKeypair(userId, network).toSuiAddress();
}
