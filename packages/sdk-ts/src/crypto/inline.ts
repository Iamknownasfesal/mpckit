/**
 * Inline (main-thread) `CryptoEngine`. Wraps `@ika.xyz/sdk` so SDK
 * consumers never need to take a transitive dep. The Web Worker
 * variant ships a parallel `worker-impl.ts` that imports the same
 * primitives but listens on `self.onmessage`.
 */
import {
  createUserSignMessageWithPublicOutput,
  Curve as IkaCurve,
  Hash as IkaHash,
  SignatureAlgorithm as IkaSignatureAlgorithm,
  prepareDKGAsync,
  UserShareEncryptionKeys,
} from "@ika.xyz/sdk";
import { Curve, Hash, SignatureAlgorithm } from "../constants";
import { fromHex, toHex } from "../util";
import type { CryptoEngine, DKGOutput, KeySession } from "./engine";

const CURVE_MAP: Record<Curve, IkaCurve> = {
  [Curve.SECP256K1]: IkaCurve.SECP256K1,
  [Curve.SECP256R1]: IkaCurve.SECP256R1,
  [Curve.ED25519]: IkaCurve.ED25519,
  [Curve.RISTRETTO]: IkaCurve.RISTRETTO,
};

const SIG_ALGO_MAP: Record<SignatureAlgorithm, IkaSignatureAlgorithm> = {
  [SignatureAlgorithm.ECDSASecp256k1]: IkaSignatureAlgorithm.ECDSASecp256k1,
  [SignatureAlgorithm.Taproot]: IkaSignatureAlgorithm.Taproot,
  [SignatureAlgorithm.ECDSASecp256r1]: IkaSignatureAlgorithm.ECDSASecp256r1,
  [SignatureAlgorithm.EdDSA]: IkaSignatureAlgorithm.EdDSA,
  [SignatureAlgorithm.SchnorrkelSubstrate]:
    IkaSignatureAlgorithm.SchnorrkelSubstrate,
};

const HASH_MAP: Record<Hash, IkaHash> = {
  [Hash.KECCAK256]: IkaHash.KECCAK256,
  [Hash.SHA256]: IkaHash.SHA256,
  [Hash.DoubleSHA256]: IkaHash.DoubleSHA256,
  [Hash.SHA512]: IkaHash.SHA512,
  [Hash.Merlin]: IkaHash.Merlin,
};

export class InlineCryptoEngine implements CryptoEngine {
  private readonly cache = new Map<string, { keys: UserShareEncryptionKeys }>();

  async openSession(seed: Uint8Array, curve: Curve): Promise<KeySession> {
    const id = await sessionId(seed, curve);
    let entry = this.cache.get(id);
    if (!entry) {
      const keys = await UserShareEncryptionKeys.fromRootSeedKey(
        seed,
        CURVE_MAP[curve],
      );
      entry = { keys };
      this.cache.set(id, entry);
    }
    return {
      id,
      suiAddress: entry.keys.getSuiAddress(),
      signingPublicKeyHex: toHex(entry.keys.getSigningPublicKeyBytes()),
      encryptionKeyHex: toHex(entry.keys.encryptionKey),
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    this.cache.delete(sessionId);
  }

  async signEncryptionKey(
    sessionId: string,
  ): Promise<{ signatureHex: string }> {
    const sig = await this.requireKeys(sessionId).getEncryptionKeySignature();
    return { signatureHex: toHex(sig) };
  }

  async signUserOutput(
    sessionId: string,
    args: { dwalletPublicOutputHex: string; userPublicOutputHex: string },
  ): Promise<{ signatureHex: string }> {
    const keys = this.requireKeys(sessionId);
    // We synthesise the minimal `dWallet` shape the upstream signer
    // reads. It only inspects `state.AwaitingKeyHolderSignature.public_output`
    // and `curve`, both of which we know.
    const fakeDwallet = {
      curve: this.curveNumberFromKeys(keys),
      state: {
        AwaitingKeyHolderSignature: {
          public_output: Array.from(fromHex(args.dwalletPublicOutputHex)),
        },
      },
    } as unknown as Parameters<typeof keys.getUserOutputSignature>[0];
    const sig = await keys.getUserOutputSignature(
      fakeDwallet,
      fromHex(args.userPublicOutputHex),
    );
    return { signatureHex: toHex(sig) };
  }

  async prepareDKG(
    sessionId: string,
    args: {
      sessionIdentifierHex: string;
      protocolPublicParametersHex: string;
      networkEncryptionKeyId: string;
      senderAddress: string;
    },
  ): Promise<DKGOutput> {
    const keys = this.requireKeys(sessionId);
    const stub = makeIkaClientStub({
      protocolPublicParameters: fromHex(args.protocolPublicParametersHex),
      networkEncryptionKeyId: args.networkEncryptionKeyId,
    });
    const dkg = await prepareDKGAsync(
      stub,
      keys.curve,
      keys,
      fromHex(args.sessionIdentifierHex),
      args.senderAddress,
    );
    return {
      userDKGMessageHex: toHex(dkg.userDKGMessage),
      userPublicOutputHex: toHex(dkg.userPublicOutput),
      encryptedCentralizedSecretShareAndProofHex: toHex(
        dkg.encryptedUserShareAndProof,
      ),
      userSecretKeyShareHex: toHex(dkg.userSecretKeyShare),
    };
  }

  async signCentralizedMessage(
    sessionId: string,
    args: {
      signatureAlgorithm: SignatureAlgorithm;
      hash: Hash;
      protocolPublicParametersHex: string;
      userPublicOutputHex: string;
      userSecretKeyShareHex: string;
      presignBytesHex: string;
      messageHex: string;
    },
  ): Promise<{ signatureHex: string }> {
    const keys = this.requireKeys(sessionId);
    const sig = await createUserSignMessageWithPublicOutput(
      fromHex(args.protocolPublicParametersHex),
      fromHex(args.userPublicOutputHex),
      fromHex(args.userSecretKeyShareHex),
      fromHex(args.presignBytesHex),
      fromHex(args.messageHex),
      HASH_MAP[args.hash],
      SIG_ALGO_MAP[args.signatureAlgorithm],
      keys.curve,
    );
    return { signatureHex: toHex(sig) };
  }

  private requireKeys(sessionId: string): UserShareEncryptionKeys {
    const entry = this.cache.get(sessionId);
    if (!entry) {
      throw new Error(`unknown session ${sessionId}; call openSession first`);
    }
    return entry.keys;
  }

  private curveNumberFromKeys(keys: UserShareEncryptionKeys): number {
    switch (keys.curve) {
      case IkaCurve.SECP256K1:
        return 0;
      case IkaCurve.SECP256R1:
        return 1;
      case IkaCurve.ED25519:
        return 2;
      case IkaCurve.RISTRETTO:
        return 3;
      default:
        throw new Error(`unknown curve ${String(keys.curve)}`);
    }
  }
}

async function sessionId(seed: Uint8Array, curve: Curve): Promise<string> {
  // Hash the seed so the session id can be logged / passed to a worker
  // without leaking key material. Copy into a non-shared buffer so
  // crypto.subtle accepts the input on every TS lib variant.
  const buf = new Uint8Array(seed.length);
  buf.set(seed);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return `${curve}:${toHex(new Uint8Array(digest))}`;
}

/**
 * Build the smallest `IkaClient`-shaped stub that satisfies what
 * `prepareDKGAsync` actually reads. Avoids dragging the full network
 * client into the engine; the `MpcKit` orchestrates network calls.
 */
function makeIkaClientStub(args: {
  protocolPublicParameters: Uint8Array;
  networkEncryptionKeyId: string;
}): Parameters<typeof prepareDKGAsync>[0] {
  return {
    getProtocolPublicParameters: async () => args.protocolPublicParameters,
    getLatestNetworkEncryptionKey: async () => ({
      id: args.networkEncryptionKeyId,
    }),
  } as unknown as Parameters<typeof prepareDKGAsync>[0];
}

export const inlineCryptoEngine = new InlineCryptoEngine();
