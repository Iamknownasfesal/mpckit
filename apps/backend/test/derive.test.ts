/**
 * Tests for the per-user deposit keypair derivation. The recipe is
 * HKDF-SHA256 over a long-lived master seed; the derived 32 bytes feed
 * Ed25519Keypair.fromSecretKey. Pin:
 *   - determinism (same seed + (userId, network) → same key)
 *   - separation between users + networks
 *   - rejection of misconfigured master seeds
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const envMock: Record<string, unknown> = {};
mock.module("@/config/env", () => ({ env: envMock }));
mock.module("@/config/log", () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const { deriveDepositAddress, deriveDepositKeypair } = await import(
  "@/shared/billing/derive"
);

const SEED_HEX = "ab".repeat(32);

describe("deriveDepositKeypair", () => {
  beforeEach(() => {
    for (const k of Object.keys(envMock)) envMock[k] = undefined;
    envMock.BILLING_DEPOSIT_MASTER_SEED_HEX = SEED_HEX;
  });
  afterEach(() => {
    for (const k of Object.keys(envMock)) envMock[k] = undefined;
  });

  test("is deterministic for the same (userId, network) pair", () => {
    const a = deriveDepositKeypair("user-1", "mainnet");
    const b = deriveDepositKeypair("user-1", "mainnet");
    expect(a.toSuiAddress()).toBe(b.toSuiAddress());
  });

  test("different userIds derive distinct addresses", () => {
    const a = deriveDepositAddress("user-1", "mainnet");
    const b = deriveDepositAddress("user-2", "mainnet");
    expect(a).not.toBe(b);
  });

  test("different networks derive distinct addresses for the same user", () => {
    const a = deriveDepositAddress("user-1", "mainnet");
    const b = deriveDepositAddress("user-1", "testnet");
    expect(a).not.toBe(b);
  });

  test("deriveDepositAddress agrees with deriveDepositKeypair.toSuiAddress", () => {
    const kp = deriveDepositKeypair("user-1", "mainnet");
    const addr = deriveDepositAddress("user-1", "mainnet");
    expect(addr).toBe(kp.toSuiAddress());
  });

  test("accepts a 0x-prefixed master seed", () => {
    envMock.BILLING_DEPOSIT_MASTER_SEED_HEX = `0x${SEED_HEX}`;
    expect(() => deriveDepositKeypair("user-1", "mainnet")).not.toThrow();
  });

  test("throws when the master seed env var is missing", () => {
    envMock.BILLING_DEPOSIT_MASTER_SEED_HEX = undefined;
    expect(() => deriveDepositKeypair("user-1", "mainnet")).toThrow(
      /master seed/,
    );
  });

  test("throws when the master seed is the wrong length", () => {
    envMock.BILLING_DEPOSIT_MASTER_SEED_HEX = "deadbeef";
    expect(() => deriveDepositKeypair("user-1", "mainnet")).toThrow(/32 bytes/);
  });

  test("throws when the master seed has non-hex characters", () => {
    envMock.BILLING_DEPOSIT_MASTER_SEED_HEX = "zz".repeat(32);
    expect(() => deriveDepositKeypair("user-1", "mainnet")).toThrow(/32 bytes/);
  });

  test("returns a valid Sui address shape", () => {
    const addr = deriveDepositAddress("user-1", "mainnet");
    expect(addr).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
