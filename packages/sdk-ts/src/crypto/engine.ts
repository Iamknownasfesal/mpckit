/**
 * Crypto boundary. Every WASM-heavy computation the SDK needs goes
 * through this interface. Two implementations:
 *
 *   - `InlineCryptoEngine`     — runs on the calling thread
 *                                (default; works in Node and browser)
 *   - `WebWorkerCryptoEngine`  — proxies calls to a Web Worker over
 *                                postMessage so the main thread isn't
 *                                blocked during DKG / sign ceremonies
 *
 * The interface is intentionally pure-data: only Uint8Arrays and
 * scalar fields cross the boundary, no class instances. That keeps the
 * worker IPC payloads `structuredClone`-friendly.
 *
 * The "session" is an opaque cache key. Inline engines treat it as
 * `${curve}:${seedHash}` and lazily derive `UserShareEncryptionKeys`
 * on first use; subsequent calls with the same session reuse the
 * derived keys (which is expensive enough to matter).
 */
import type { Curve, Hash, SignatureAlgorithm } from "../constants";

export interface KeySession {
  /** Opaque token that resolves to a derived key set. */
  id: string;
  /** Sui address derived from the seed for this curve. */
  suiAddress: string;
  /** Signing public key (32 bytes Ed25519, hex). */
  signingPublicKeyHex: string;
  /** Class-groups encryption key bytes (hex). */
  encryptionKeyHex: string;
}

export interface DKGOutput {
  userDKGMessageHex: string;
  userPublicOutputHex: string;
  encryptedCentralizedSecretShareAndProofHex: string;
  /** Kept locally on the user side for later signing. */
  userSecretKeyShareHex: string;
}

export interface CryptoEngine {
  /**
   * Derive per-curve key material from a 32-byte seed and stash it
   * under an opaque session id. Idempotent: same seed + curve returns
   * the same id and key set.
   */
  openSession(seed: Uint8Array, curve: Curve): Promise<KeySession>;

  /** Free the derived key material. Optional — engines may no-op. */
  closeSession(sessionId: string): Promise<void>;

  /**
   * Sign the user's encryption key bytes with the seed-derived signer.
   * Backend's encryption-key endpoint requires this signature.
   */
  signEncryptionKey(sessionId: string): Promise<{ signatureHex: string }>;

  /**
   * Sign the dwallet's public output. Backend's accept endpoint
   * verifies this against the dwallet on chain.
   */
  signUserOutput(
    sessionId: string,
    args: {
      /** Bytes of the dwallet's public output as observed on chain. */
      dwalletPublicOutputHex: string;
      /** Bytes of the user-side public output computed during DKG. */
      userPublicOutputHex: string;
    },
  ): Promise<{ signatureHex: string }>;

  /**
   * Run the DKG ceremony locally. The backend submits the resulting
   * PTB; only the user holds `userSecretKeyShareHex`.
   */
  prepareDKG(
    sessionId: string,
    args: {
      sessionIdentifierHex: string;
      protocolPublicParametersHex: string;
      networkEncryptionKeyId: string;
      /**
       * Sui address that will actually submit the DKG PTB. The DKG
       * message is bound to this address and the network rejects
       * verification if the on-chain sender doesn't match.
       */
      senderAddress: string;
    },
  ): Promise<DKGOutput>;

  /**
   * Produce the centralized message signature for a sign request.
   * Bound to a specific presign's bytes; the backend's two-phase API
   * gives us those bytes after reserving the presign.
   */
  signCentralizedMessage(
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
  ): Promise<{ signatureHex: string }>;
}
