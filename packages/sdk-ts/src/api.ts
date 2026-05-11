/**
 * `MpcKit` is the single class consumers see. It composes:
 *
 *   - the typed HTTP client for MpcKit
 *   - a `CryptoEngine` (defaults to `InlineCryptoEngine`; swap in
 *     `WebWorkerCryptoEngine` to keep the main thread responsive)
 *   - a lazily-constructed `IkaClient` for the small set of network
 *     reads the SDK needs (network encryption key, dwallet state polls,
 *     protocol public parameters)
 *
 * High-level operations (`onboard`, `sign`) drive multi-step ceremonies
 * end-to-end. Low-level HTTP wrappers (`raw.*`) give consumers the
 * escape hatch when they want to compose differently.
 */
import { IkaClient, getNetworkConfig } from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Curve, Hash, Network, SignatureAlgorithm } from "./constants";
import { Curve as CurveEnum } from "./constants";
import type { CryptoEngine } from "./crypto/engine";
import { inlineCryptoEngine } from "./crypto/inline";
import {
  MpcKitError,
  MpcKitInsufficientCreditsError,
  MpcKitTimeoutError,
} from "./errors";
import { HttpClient } from "./http";
import type {
  BillingCharge,
  BillingDeposit,
  BillingPricing,
  DWallet,
  EncryptionKey,
  NetworkInfo,
  SignRequest,
} from "./types";
import {
  fromBase64,
  fromHex,
  newIdempotencyKey,
  pollUntil,
  randomSessionIdentifier,
  toHex,
} from "./util";

const CURVE_NUMBER: Record<Curve, number> = {
  [CurveEnum.SECP256K1]: 0,
  [CurveEnum.SECP256R1]: 1,
  [CurveEnum.ED25519]: 2,
  [CurveEnum.RISTRETTO]: 3,
};

/**
 * Hosted MpcKit endpoints. `network` selects which one is used by default.
 * Pass a custom `baseUrl` to override (self-hosting, dev, on-prem).
 */
export const MPCKIT_HOSTS = {
  mainnet: "https://api.mpckit.xyz",
  testnet: "https://api.testnet.mpckit.xyz",
} as const satisfies Record<Network, string>;

export function defaultBaseUrl(network: Network): string {
  return MPCKIT_HOSTS[network];
}

export interface MpcKitOptions {
  /** API key issued by the backend. */
  apiKey: string;
  /** Which Sui network to talk to. Picks the default backend host. */
  network: Network;
  /** Override the backend base URL. Defaults to the hosted endpoint for `network`. */
  baseUrl?: string;
  /** Optional Sui gRPC URL override (defaults to Mysten public fullnode). */
  suiRpcUrl?: string;
  /** Override the crypto engine; defaults to `InlineCryptoEngine`. */
  crypto?: CryptoEngine;
  /** Override fetch (test injection, custom retry). */
  fetch?: typeof fetch;
  /** Per-request HTTP timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
}

export interface OnboardArgs {
  /** 32-byte secret seed (PRF output, env-stored secret, etc.). */
  seed: Uint8Array;
  curve: Curve;
  /** Polling timeout for AwaitingKeyHolderSignature. Default 10 min. */
  timeoutMs?: number;
}

export interface OnboardResult {
  dwallet: DWallet;
  encryptionKey: EncryptionKey;
  encryptedUserSecretKeyShareId: string;
  /**
   * Bytes the consumer must persist alongside the dwallet to be able
   * to sign. We never send these to the backend.
   */
  userSecretKeyShareHex: string;
  userPublicOutputHex: string;
  txDigests: { onboard: string; accept: string };
}

export interface SignArgs {
  seed: Uint8Array;
  dwalletId: string;
  curve: Curve;
  signatureAlgorithm: SignatureAlgorithm;
  hashScheme: Hash;
  message: Uint8Array;
  /** Returned by `onboard()`. Persist alongside the dwallet. */
  userSecretKeyShareHex: string;
  /** Reuse for retry safety. Auto-generated otherwise. */
  idempotencyKey?: string;
  /** Override default 3-minute end-to-end timeout. */
  timeoutMs?: number;
}

export interface SignResult {
  signature: Uint8Array;
  signRequestId: string;
  signSessionId: string;
  txDigest: string | null;
}

export class MpcKit {
  private readonly http: HttpClient;
  private readonly crypto: CryptoEngine;
  private readonly network: Network;
  private readonly suiRpcUrl: string;
  private readonly protocolParametersCache = new Map<Curve, Uint8Array>();
  private ikaClient: IkaClient | undefined;

  constructor(opts: MpcKitOptions) {
    this.http = new HttpClient({
      baseUrl: opts.baseUrl ?? defaultBaseUrl(opts.network),
      apiKey: opts.apiKey,
      fetch: opts.fetch,
      timeoutMs: opts.timeoutMs,
    });
    this.crypto = opts.crypto ?? inlineCryptoEngine;
    this.network = opts.network;
    this.suiRpcUrl =
      opts.suiRpcUrl ??
      (opts.network === "mainnet"
        ? "https://fullnode.mainnet.sui.io:443"
        : "https://fullnode.testnet.sui.io:443");
  }

  // ── Raw HTTP escape hatch ─────────────────────────────────────────

  get raw(): HttpClient {
    return this.http;
  }

  // ── Public introspection ──────────────────────────────────────────

  health(): Promise<{
    ok: boolean;
    service: string;
    uptime: number;
    now: string;
  }> {
    return this.http.get("/v1/health");
  }
  networkInfo(): Promise<NetworkInfo> {
    return this.http.get("/v1/network");
  }

  /**
   * Protocol public parameters bytes for a curve. The upstream
   * `IkaClient.getProtocolPublicParameters` fetches a 44 MB blob from
   * the Sui fullnode's chunked table-vec; that's ~11 s cold and ~2 s
   * even with the upstream cache. The backend already pre-computes
   * this at boot for all curves and serves it from an LRU keyed on
   * `(curve, networkEncryptionKeyId)`, so going through us is ~50 ms
   * after the first call.
   *
   * The returned bytes are cached on this `MpcKit` instance until
   * `invalidateProtocolParametersCache()` is called. Backend cache
   * invalidation is automatic on network reconfiguration; long-lived
   * SDK instances that span a reconfiguration should clear after
   * receiving a `RECONFIGURATION` signal (TODO once we expose one).
   */
  async protocolParameters(curve: Curve): Promise<Uint8Array> {
    const cached = this.protocolParametersCache.get(curve);
    if (cached) return cached;
    const res = await this.http.get<{
      curve: number;
      encryptionKeyId: string;
      epoch: number;
      loadedAt: number;
      bytesBase64: string;
      bytesLength: number;
    }>(`/v1/protocol-parameters?curve=${CURVE_NUMBER[curve]}`);
    const bytes = fromBase64(res.bytesBase64);
    this.protocolParametersCache.set(curve, bytes);
    return bytes;
  }

  invalidateProtocolParametersCache(): void {
    this.protocolParametersCache.clear();
  }

  // ── Billing ───────────────────────────────────────────────────────

  depositAddress(): Promise<{ address: string }> {
    return this.http.get("/v1/billing/address");
  }
  balance(): Promise<{ creditsMicro: string; creditsUsd: string }> {
    return this.http.get("/v1/billing/balance");
  }
  billingPricing(): Promise<BillingPricing> {
    return this.http.get("/v1/billing/pricing");
  }
  declareDeposit(txDigest: string): Promise<{
    deposit: BillingDeposit;
    duplicate: boolean;
    creditsMicro: string;
    creditsUsd: string;
  }> {
    return this.http.post("/v1/billing/deposit", { txDigest });
  }
  billingHistory(): Promise<{
    deposits: BillingDeposit[];
    charges: BillingCharge[];
  }> {
    return this.http.get("/v1/billing/history");
  }

  // ── DWallets ──────────────────────────────────────────────────────

  listDWallets(): Promise<{ dwallets: DWallet[] }> {
    return this.http.get("/v1/dwallets");
  }
  getDWallet(id: string): Promise<{ dwallet: DWallet }> {
    return this.http.get(`/v1/dwallets/${encodeURIComponent(id)}`);
  }

  // ── End-to-end onboard (zero-trust DKG + accept) ─────────────────

  async onboard(args: OnboardArgs): Promise<OnboardResult> {
    const ika = await this.ika();
    const session = await this.crypto.openSession(args.seed, args.curve);

    // 1. Encryption key registration. Idempotent server-side on
    //    (user, curve) so retries are free.
    const encSig = await this.crypto.signEncryptionKey(session.id);
    const encryptionKey = await this.http.post<EncryptionKey>(
      "/v1/encryption-keys",
      {
        curve: CURVE_NUMBER[args.curve],
        encryptionKeyHex: session.encryptionKeyHex,
        encryptionKeySignatureHex: encSig.signatureHex,
        signerPublicKeyHex: session.signingPublicKeyHex,
      },
    );

    // 2. Local DKG. The DKG message is bound to the address that will
    //    submit the on-chain PTB; the backend's operator hot wallet is
    //    that submitter, so we pull its address from /v1/network. We
    //    fetch protocol params + the latest network encryption-key id
    //    from the backend (cached + boot-warmed) instead of from the
    //    Sui fullnode directly, which saves ~11 s on the cold path.
    const sessionIdBytes = randomSessionIdentifier();
    const [netInfo, protocolPublicParameters] = await Promise.all([
      this.networkInfo(),
      this.protocolParameters(args.curve),
    ]);
    const dkg = await this.crypto.prepareDKG(session.id, {
      sessionIdentifierHex: toHex(sessionIdBytes),
      protocolPublicParametersHex: toHex(protocolPublicParameters),
      networkEncryptionKeyId: netInfo.latestEncryptionKey.id,
      senderAddress: netInfo.operatorAddress,
    });

    // 3. Submit DKG onboard PTB.
    const onboardRes = await this.http.post<{
      account: { id: string; suiObjectId: string; createdInThisTx: boolean };
      dwallet: DWallet;
      txDigest: string;
      encryptedUserSecretKeyShareId: string;
    }>("/v1/dwallets", {
      encryptionKeyId: encryptionKey.id,
      dwalletNetworkEncryptionKeyId: netInfo.latestEncryptionKey.id,
      centralizedPublicKeyShareAndProofHex: dkg.userDKGMessageHex,
      encryptedCentralizedSecretShareAndProofHex:
        dkg.encryptedCentralizedSecretShareAndProofHex,
      userPublicOutputHex: dkg.userPublicOutputHex,
      signerPublicKeyHex: session.signingPublicKeyHex,
      sessionIdentifierHex: toHex(sessionIdBytes),
    });

    // 4. Wait for AwaitingKeyHolderSignature so the public output is
    //    finalised on chain.
    const awaitingDw = await ika.getDWalletInParticularState(
      onboardRes.dwallet.suiDwalletId,
      "AwaitingKeyHolderSignature",
      { timeout: args.timeoutMs ?? 600_000, interval: 2_000 },
    );
    const dwalletPublicOutput = new Uint8Array(
      (
        awaitingDw.state as {
          AwaitingKeyHolderSignature: { public_output: number[] };
        }
      ).AwaitingKeyHolderSignature.public_output,
    );

    // 5. Sign the dwallet's public output and accept.
    const userOutputSig = await this.crypto.signUserOutput(session.id, {
      dwalletPublicOutputHex: toHex(dwalletPublicOutput),
      userPublicOutputHex: dkg.userPublicOutputHex,
    });
    const accept = await this.http.post<{ dwallet: DWallet }>(
      `/v1/dwallets/${encodeURIComponent(onboardRes.dwallet.id)}/accept`,
      {
        encryptedUserSecretKeyShareId: onboardRes.encryptedUserSecretKeyShareId,
        userOutputSignatureHex: userOutputSig.signatureHex,
      },
    );

    return {
      dwallet: accept.dwallet,
      encryptionKey,
      encryptedUserSecretKeyShareId: onboardRes.encryptedUserSecretKeyShareId,
      userSecretKeyShareHex: dkg.userSecretKeyShareHex,
      userPublicOutputHex: dkg.userPublicOutputHex,
      txDigests: {
        onboard: onboardRes.txDigest,
        accept: accept.dwallet.acceptTxDigest ?? "",
      },
    };
  }

  // ── End-to-end sign (two-phase prepare + submit + poll) ──────────

  async sign(args: SignArgs): Promise<SignResult> {
    const session = await this.crypto.openSession(args.seed, args.curve);
    const ika = await this.ika();

    // Phase 1: reserve a presign + get its bytes.
    const idempotencyKey = args.idempotencyKey ?? newIdempotencyKey();
    const prepared = await this.http.post<{
      signRequest: SignRequest;
      duplicate: boolean;
      presignBytesHex: string;
      presignSuiObjectId: string;
    }>(
      "/v1/sign",
      {
        dwalletId: args.dwalletId,
        signatureAlgorithm: 0, // numeric form filled below
        hashScheme: 0,
        messageHex: toHex(args.message),
      },
      { idempotencyKey, body: this.signBody(args) },
    );

    // Phase 1.5: produce the centralized signature locally.
    // The WASM signer needs the dwallet's *active* public output (the
    // post-DKG, network-finalised one), NOT the user-side intermediate
    // output we cached during onboard. Pull it from chain. Protocol
    // params come from the backend's cached endpoint to avoid the
    // ~2 s upstream fetch on every sign.
    const dwResp = await this.getDWallet(args.dwalletId);
    const [activeDw, protocolPublicParameters] = await Promise.all([
      ika.getDWalletInParticularState(dwResp.dwallet.suiDwalletId, "Active", {
        timeout: args.timeoutMs ?? 60_000,
        interval: 1_000,
      }),
      this.protocolParameters(args.curve),
    ]);
    const dwalletPublicOutput = new Uint8Array(
      (activeDw.state as { Active: { public_output: number[] } }).Active
        .public_output,
    );
    const centralizedSig = await this.crypto.signCentralizedMessage(
      session.id,
      {
        signatureAlgorithm: args.signatureAlgorithm,
        hash: args.hashScheme,
        protocolPublicParametersHex: toHex(protocolPublicParameters),
        userPublicOutputHex: toHex(dwalletPublicOutput),
        userSecretKeyShareHex: args.userSecretKeyShareHex,
        presignBytesHex: prepared.presignBytesHex,
        messageHex: toHex(args.message),
      },
    );

    // Phase 2: submit.
    const sessionIdBytes = randomSessionIdentifier();
    await this.http.post<{ signRequest: SignRequest }>(
      `/v1/sign/${encodeURIComponent(prepared.signRequest.id)}/submit`,
      {
        messageCentralizedSignatureHex: centralizedSig.signatureHex,
        sessionIdentifierHex: toHex(sessionIdBytes),
      },
    );

    // Poll until completion.
    const final = await pollUntil<SignRequest>(
      async () => {
        const res = await this.http.get<{ signRequest: SignRequest }>(
          `/v1/sign/${encodeURIComponent(prepared.signRequest.id)}`,
        );
        return res.signRequest;
      },
      (sr) => sr.status === "completed" || sr.status === "failed",
      { timeoutMs: args.timeoutMs ?? 180_000, intervalMs: 1_500 },
    );

    if (final.status === "failed") {
      throw new MpcKitError(
        `sign failed: ${final.errorMessage ?? final.errorCode ?? "unknown"}`,
        422,
        final.errorCode ?? "SIGN_FAILED",
        final,
      );
    }
    if (!final.signatureHex) {
      throw new MpcKitError(
        "sign completed without signature",
        500,
        "SIGN_BAD_SHAPE",
        final,
      );
    }
    return {
      signature: fromHex(final.signatureHex),
      signRequestId: final.id,
      signSessionId: final.signSessionId ?? "",
      txDigest: final.txDigest,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async ika(): Promise<IkaClient> {
    if (this.ikaClient) return this.ikaClient;
    const sui = new SuiGrpcClient({
      network: this.network,
      baseUrl: this.suiRpcUrl,
    });
    const c = new IkaClient({
      suiClient: sui,
      config: getNetworkConfig(this.network),
      cache: true,
    });
    await c.initialize();
    this.ikaClient = c;
    return c;
  }

  private signBody(args: SignArgs): Record<string, unknown> {
    // We need numeric forms for the backend. Build them once + reuse.
    const sigAlgo = SIG_ALGO_NUMBER[args.curve]?.[args.signatureAlgorithm];
    const hash =
      HASH_NUMBER[args.curve]?.[args.signatureAlgorithm]?.[args.hashScheme];
    if (sigAlgo === undefined || hash === undefined) {
      throw new MpcKitError(
        `invalid sig/hash combination for curve ${args.curve}`,
        400,
        "INVALID_SIG_HASH",
        {
          curve: args.curve,
          sigAlgo: args.signatureAlgorithm,
          hash: args.hashScheme,
        },
      );
    }
    return {
      dwalletId: args.dwalletId,
      signatureAlgorithm: sigAlgo,
      hashScheme: hash,
      messageHex: toHex(args.message),
    };
  }
}

const SIG_ALGO_NUMBER: Record<string, Record<string, number>> = {
  SECP256K1: { ECDSASecp256k1: 0, Taproot: 1 },
  SECP256R1: { ECDSASecp256r1: 0 },
  ED25519: { EdDSA: 0 },
  RISTRETTO: { SchnorrkelSubstrate: 0 },
};

const HASH_NUMBER: Record<string, Record<string, Record<string, number>>> = {
  SECP256K1: {
    ECDSASecp256k1: { KECCAK256: 0, SHA256: 1, DoubleSHA256: 2 },
    Taproot: { SHA256: 0 },
  },
  SECP256R1: { ECDSASecp256r1: { SHA256: 0 } },
  ED25519: { EdDSA: { SHA512: 0 } },
  RISTRETTO: { SchnorrkelSubstrate: { Merlin: 0 } },
};

export { MpcKitError, MpcKitInsufficientCreditsError, MpcKitTimeoutError };
