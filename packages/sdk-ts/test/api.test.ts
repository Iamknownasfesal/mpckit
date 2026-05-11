/**
 * Behavioural tests for `MpcKit`. Bun's module mocking is process-
 * global, so onboard + sign cases live in one file rather than
 * leaking partial `@ika.xyz/sdk` stubs across test files.
 *
 * Two regressions are pinned here:
 *
 *   1. `onboard()` must thread `operatorAddress` from `/v1/network`
 *      into `prepareDKG.senderAddress`. Pre-fix the network rejected
 *      DKG verification because it was bound to the user-derived
 *      address while the operator hot wallet submitted the PTB.
 *
 *   2. `sign()` must read `dWallet.state.Active.public_output` and
 *      pass it to `signCentralizedMessage`. Pre-fix we passed the
 *      user-side DKG `userPublicOutput` and the WASM signer threw
 *      "unexpected end of input".
 */
import { describe, expect, mock, test } from "bun:test";
import type { CryptoEngine, KeySession } from "../src/crypto/engine";

// `@ika.xyz/sdk` is statically imported by `crypto/inline.ts` (default
// crypto engine) even though our tests inject their own engine. We
// mock the full surface they touch so module load doesn't blow up.
mock.module("@ika.xyz/sdk", () => ({
  getNetworkConfig: () => ({ packages: {}, objects: {} }),
  IkaClient: class {
    initialize = async () => undefined;
    getLatestNetworkEncryptionKey = async () => ({ id: "0xNETKEY" });
    getProtocolPublicParameters = async () => new Uint8Array([0xaa]);
    getDWalletInParticularState = async (_id: string, state: string) => {
      if (state === "AwaitingKeyHolderSignature") {
        return {
          state: { AwaitingKeyHolderSignature: { public_output: [9, 9, 9] } },
        };
      }
      return { state: { Active: { public_output: [0xde, 0xad, 0xbe, 0xef] } } };
    };
  },
  Curve: { SECP256K1: 0, SECP256R1: 1, ED25519: 2, RISTRETTO: 3 },
  Hash: { KECCAK256: 0, SHA256: 1, DoubleSHA256: 2, SHA512: 3, Merlin: 4 },
  SignatureAlgorithm: {
    ECDSASecp256k1: 0,
    Taproot: 1,
    ECDSASecp256r1: 2,
    EdDSA: 3,
    SchnorrkelSubstrate: 4,
  },
  UserShareEncryptionKeys: class {
    static fromRootSeedKey = async () => new this();
  },
  createUserSignMessageWithPublicOutput: async () => new Uint8Array(),
  prepareDKGAsync: async () => ({
    userDKGMessage: new Uint8Array(),
    userPublicOutput: new Uint8Array(),
    encryptedUserShareAndProof: new Uint8Array(),
    userSecretKeyShare: new Uint8Array(),
  }),
}));
mock.module("@mysten/sui/grpc", () => ({ SuiGrpcClient: class {} }));

const { MpcKit } = await import("../src/api");
const { Curve, Hash, SignatureAlgorithm } = await import("../src/constants");

const OPERATOR = "0xOPERATOR_ADDRESS";
const USER_ADDRESS = "0xUSER_ADDRESS";

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const path = new URL(url).pathname;
    const body = routes[path];
    if (!body) {
      return new Response(JSON.stringify({ error: `no stub for ${path}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body), {
      status: path === "/v1/sign" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function fakeEngine(captures: {
  prepareDKG: { senderAddress: string }[];
  signCentralized: { userPublicOutputHex: string }[];
}): CryptoEngine {
  const session: KeySession = {
    id: "s",
    suiAddress: USER_ADDRESS,
    signingPublicKeyHex: "00",
    encryptionKeyHex: "00",
  };
  return {
    openSession: mock(async () => session),
    closeSession: mock(async () => undefined),
    signEncryptionKey: mock(async () => ({ signatureHex: "ab" })),
    signUserOutput: mock(async () => ({ signatureHex: "cd" })),
    prepareDKG: mock(async (_sid, args) => {
      captures.prepareDKG.push({ senderAddress: args.senderAddress });
      return {
        userDKGMessageHex: "00",
        userPublicOutputHex: "ff".repeat(238),
        encryptedCentralizedSecretShareAndProofHex: "00",
        userSecretKeyShareHex: "00",
      };
    }),
    signCentralizedMessage: mock(async (_sid, args) => {
      captures.signCentralized.push({
        userPublicOutputHex: args.userPublicOutputHex,
      });
      return { signatureHex: "deadbeef" };
    }),
  };
}

describe("MpcKit.onboard", () => {
  test("threads operatorAddress from /v1/network into prepareDKG", async () => {
    const captures = { prepareDKG: [], signCentralized: [] } as Parameters<
      typeof fakeEngine
    >[0];
    const api = new MpcKit({
      baseUrl: "http://localhost:0",
      apiKey: "test",
      network: "testnet",
      crypto: fakeEngine(captures),
      fetch: fakeFetch({
        "/v1/network": {
          operatorAddress: OPERATOR,
          packages: {},
          objects: {},
          latestEncryptionKey: { id: "0xK", epoch: 1, loadedAt: 0 },
        },
        "/v1/protocol-parameters": {
          curve: 0,
          encryptionKeyId: "0xK",
          epoch: 1,
          loadedAt: 0,
          bytesBase64: Buffer.from(new Uint8Array([0xaa, 0xbb])).toString(
            "base64",
          ),
          bytesLength: 2,
        },
        "/v1/encryption-keys": {
          id: "ek-1",
          curve: 0,
          suiObjectId: "0xEK",
          suiAddress: USER_ADDRESS,
          suiTxDigest: "DEK",
        },
        "/v1/dwallets": {
          account: { id: "a", suiObjectId: "0xACC", createdInThisTx: true },
          dwallet: {
            id: "dw-1",
            accountId: "a",
            suiDwalletId: "0xDW",
            curve: 0,
            kind: "zero_trust",
            status: "awaiting_user_share",
            encryptionKeyId: "0xK",
            dkgTxDigest: "DKG",
            acceptTxDigest: null,
            createdAt: "2026-05-08T00:00:00Z",
            updatedAt: "2026-05-08T00:00:00Z",
          },
          txDigest: "DKG",
          encryptedUserSecretKeyShareId: "0xES",
        },
        "/v1/dwallets/dw-1/accept": {
          dwallet: {
            id: "dw-1",
            accountId: "a",
            suiDwalletId: "0xDW",
            curve: 0,
            kind: "zero_trust",
            status: "active",
            encryptionKeyId: "0xK",
            dkgTxDigest: "DKG",
            acceptTxDigest: "ACC",
            createdAt: "2026-05-08T00:00:00Z",
            updatedAt: "2026-05-08T00:00:00Z",
          },
        },
      }),
    });
    await api.onboard({ seed: new Uint8Array(32), curve: Curve.SECP256K1 });
    expect(captures.prepareDKG).toHaveLength(1);
    expect(captures.prepareDKG[0]!.senderAddress).toBe(OPERATOR);
    expect(captures.prepareDKG[0]!.senderAddress).not.toBe(USER_ADDRESS);
  });
});

describe("MpcKit.sign", () => {
  test("uses dwallet Active.public_output, not user-side DKG output", async () => {
    const captures = { prepareDKG: [], signCentralized: [] } as Parameters<
      typeof fakeEngine
    >[0];
    const completedSign = {
      id: "sr-1",
      status: "completed" as const,
      txDigest: "TX",
      signSessionId: "ss-1",
      signatureHex: "deadbeef",
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-05-08T00:00:00Z",
      updatedAt: "2026-05-08T00:00:00Z",
      completedAt: "2026-05-08T00:00:00Z",
    };
    const api = new MpcKit({
      baseUrl: "http://localhost:0",
      apiKey: "test",
      network: "testnet",
      crypto: fakeEngine(captures),
      fetch: fakeFetch({
        "/v1/protocol-parameters": {
          curve: 0,
          encryptionKeyId: "0xK",
          epoch: 1,
          loadedAt: 0,
          bytesBase64: Buffer.from(new Uint8Array([0xaa])).toString("base64"),
          bytesLength: 1,
        },
        "/v1/dwallets/dw-1": {
          dwallet: {
            id: "dw-1",
            accountId: "a",
            suiDwalletId: "0xDW",
            curve: 0,
            kind: "zero_trust",
            status: "active",
            encryptionKeyId: "0xK",
            dkgTxDigest: "DKG",
            acceptTxDigest: "ACC",
            createdAt: "2026-05-08T00:00:00Z",
            updatedAt: "2026-05-08T00:00:00Z",
          },
        },
        "/v1/sign": {
          signRequest: { ...completedSign, status: "queued" },
          duplicate: false,
          presignBytesHex: "abcd",
          presignSuiObjectId: "0xPC",
        },
        "/v1/sign/sr-1/submit": { signRequest: completedSign },
        "/v1/sign/sr-1": { signRequest: completedSign },
      }),
    });
    await api.sign({
      seed: new Uint8Array(32),
      dwalletId: "dw-1",
      curve: Curve.SECP256K1,
      signatureAlgorithm: SignatureAlgorithm.Taproot,
      hashScheme: Hash.SHA256,
      message: new Uint8Array(32),
      userSecretKeyShareHex: "00".repeat(35),
      timeoutMs: 5_000,
    });
    expect(captures.signCentralized).toHaveLength(1);
    // Active.public_output stub above is [0xde, 0xad, 0xbe, 0xef].
    expect(captures.signCentralized[0]!.userPublicOutputHex).toBe("deadbeef");
  });
});
