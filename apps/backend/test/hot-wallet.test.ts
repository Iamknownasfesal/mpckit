/**
 * Pins the hot wallet provider matrix:
 *
 *   - env      reads HOT_WALLET_SUI_SECRET_HEX
 *   - aws-kms  decrypts HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64 via KMS
 *
 * The KMS decrypt is exercised via a mocked `@aws-sdk/client-kms` so
 * the test runs without AWS credentials. We verify both paths produce
 * the same Sui address when fed the same plaintext seed — the KMS
 * indirection is purely about where the seed comes from.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const SEED_BYTES = new Uint8Array(32);
for (let i = 0; i < 32; i++) SEED_BYTES[i] = i + 1;
const SEED_HEX = Buffer.from(SEED_BYTES).toString("hex");
const EXPECTED_ADDR = Ed25519Keypair.fromSecretKey(SEED_BYTES)
  .getPublicKey()
  .toSuiAddress();

const decryptCalls: { CiphertextBlob: Uint8Array; KeyId?: string }[] = [];
let kmsPlaintext: Uint8Array | undefined = SEED_BYTES;

mock.module("@aws-sdk/client-kms", () => ({
  KMSClient: class {
    async send(cmd: { input: { CiphertextBlob: Uint8Array; KeyId?: string } }) {
      decryptCalls.push(cmd.input);
      if (!kmsPlaintext) {
        throw new Error("kms: simulated failure");
      }
      return { Plaintext: kmsPlaintext };
    }
    destroy() {}
  },
  // The real `DecryptCommand` is constructed with `new DecryptCommand(input)`;
  // mock it as something whose `.input` exposes the params we received.
  DecryptCommand: class {
    public readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

mock.module("@/config/log", () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

const envMock: Record<string, unknown> = {};
mock.module("@/config/env", () => ({ env: envMock }));

const {
  warmHotWallet,
  getHotWallet,
  isHotWalletConfigured,
  _resetHotWalletForTest,
} = await import("@/shared/sui/hot-wallet");

describe("hot wallet provider", () => {
  beforeEach(() => {
    _resetHotWalletForTest();
    decryptCalls.length = 0;
    kmsPlaintext = SEED_BYTES;
    for (const k of Object.keys(envMock)) delete envMock[k];
  });
  afterEach(() => {
    _resetHotWalletForTest();
  });

  test("env provider reads HOT_WALLET_SUI_SECRET_HEX", async () => {
    envMock.HOT_WALLET_PROVIDER = "env";
    envMock.HOT_WALLET_SUI_SECRET_HEX = SEED_HEX;
    expect(isHotWalletConfigured()).toBe(true);
    await warmHotWallet();
    expect(getHotWallet().address()).toBe(EXPECTED_ADDR);
    expect(decryptCalls).toHaveLength(0);
  });

  test("env provider rejects malformed hex", async () => {
    envMock.HOT_WALLET_PROVIDER = "env";
    envMock.HOT_WALLET_SUI_SECRET_HEX = "deadbeef"; // 4 bytes, not 32
    await expect(warmHotWallet()).rejects.toThrow(/32 bytes/);
  });

  test("aws-kms provider decrypts ciphertext + matches the env seed address", async () => {
    envMock.HOT_WALLET_PROVIDER = "aws-kms";
    envMock.HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64 = Buffer.from(
      "any-ciphertext-bytes",
    ).toString("base64");
    expect(isHotWalletConfigured()).toBe(true);
    await warmHotWallet();
    expect(getHotWallet().address()).toBe(EXPECTED_ADDR);
    expect(decryptCalls).toHaveLength(1);
    // KeyId is omitted unless HOT_WALLET_KMS_KEY_ID is set.
    expect(decryptCalls[0]!.KeyId).toBeUndefined();
  });

  test("aws-kms provider passes KeyId when configured", async () => {
    envMock.HOT_WALLET_PROVIDER = "aws-kms";
    envMock.HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64 =
      Buffer.from("ct").toString("base64");
    envMock.HOT_WALLET_KMS_KEY_ID = "alias/mpckit-hot-wallet";
    await warmHotWallet();
    expect(decryptCalls[0]!.KeyId).toBe("alias/mpckit-hot-wallet");
  });

  test("aws-kms rejects wrong-length plaintext (KMS misconfigured)", async () => {
    envMock.HOT_WALLET_PROVIDER = "aws-kms";
    envMock.HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64 =
      Buffer.from("ct").toString("base64");
    kmsPlaintext = new Uint8Array(16); // half the expected seed length
    await expect(warmHotWallet()).rejects.toThrow(/expected 32/);
  });

  test("aws-kms surfaces KMS errors", async () => {
    envMock.HOT_WALLET_PROVIDER = "aws-kms";
    envMock.HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64 =
      Buffer.from("ct").toString("base64");
    kmsPlaintext = undefined;
    await expect(warmHotWallet()).rejects.toThrow(/simulated failure/);
  });

  test("getHotWallet before warmup throws", () => {
    envMock.HOT_WALLET_PROVIDER = "env";
    envMock.HOT_WALLET_SUI_SECRET_HEX = SEED_HEX;
    expect(() => getHotWallet()).toThrow(/not warmed/);
  });
});
