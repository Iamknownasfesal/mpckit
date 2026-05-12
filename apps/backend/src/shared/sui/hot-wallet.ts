import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { SuiClientTypes } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Transaction } from "@mysten/sui/transactions";
/**
 * Hot wallet adapter.
 *
 * Pays SUI gas + supplies IKA fees for every PTB the backend submits
 * (encryption-key registration, account registration, DKG, accept,
 * sign, etc.). The 32-byte Ed25519 seed comes from one of two
 * providers, selected by `HOT_WALLET_PROVIDER`:
 *
 *   - **env** (dev / single-node testnet) — the seed sits in
 *     `HOT_WALLET_SUI_SECRET_HEX`. Acceptable when the operator
 *     accepts that anyone with read access to the env or container
 *     image owns the key. Default for backwards compatibility.
 *
 *   - **aws-kms** (production) — the seed is wrapped via AWS KMS
 *     envelope encryption: operator encrypts 32 random bytes with a
 *     KMS CMK once, ships the ciphertext blob in
 *     `HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64`, and grants the
 *     backend's IAM role `kms:Decrypt` on the key. The plaintext
 *     seed exists only in process memory. KMS doesn't sign Ed25519
 *     directly (`SIGN_VERIFY` doesn't include EdDSA), so we use it
 *     for envelope encryption rather than as a signing oracle.
 *
 * Boot lifecycle: `warmHotWallet()` is called once from `api.ts` /
 * `worker.ts` before any route or job runs, so synchronous callers
 * can rely on `getHotWallet()` returning the populated singleton.
 */
import type { IkaNetwork } from "@/config/env";
import { env } from "@/config/env";
import { log } from "@/config/log";
import { getSuiClient } from "@/shared/sui/client";

/**
 * Normalised success shape; everything routes / workers need to extract
 * created object ids and parse Move events lives here.
 */
export interface ExecutedTx {
  digest: string;
  effects: SuiClientTypes.TransactionEffects;
  events: SuiClientTypes.Event[];
  /** Map of objectId -> Move type tag (`0xpkg::module::Type<...>`). */
  objectTypes: Record<string, string>;
}

/**
 * Anything that can build a Sui address + sign a `Transaction`. KMS
 * adapters return a signed-tx payload; we then submit through the
 * same gRPC client we use elsewhere.
 */
export interface HotWallet {
  /** Sui address controlled by this hot wallet (same on every network). */
  address(): string;
  /**
   * Sign the transaction and submit it to the given network. Throws on
   * `FailedTransaction` so route handlers don't have to narrow.
   */
  signAndExecute(tx: Transaction, network: IkaNetwork): Promise<ExecutedTx>;
  /**
   * Sign already-built transaction bytes. Used by the sponsored-tx
   * path: we build a PTB whose sender is a per-user derived address
   * and whose gas owner is this hot wallet, then collect both
   * signatures and submit. Network-agnostic — the bytes already encode
   * the chain identifier.
   */
  signTransaction(bytes: Uint8Array): Promise<{ signature: string }>;
}

class Ed25519HotWallet implements HotWallet {
  private kp: Ed25519Keypair;
  private addr: string;

  constructor(seed: Uint8Array) {
    if (seed.length !== 32) {
      throw new Error(`hot wallet seed must be 32 bytes; got ${seed.length}`);
    }
    this.kp = Ed25519Keypair.fromSecretKey(seed);
    this.addr = this.kp.getPublicKey().toSuiAddress();
  }

  address(): string {
    return this.addr;
  }

  async signAndExecute(
    tx: Transaction,
    network: IkaNetwork,
  ): Promise<ExecutedTx> {
    if (!tx.getData().sender) tx.setSender(this.addr);
    const result = await getSuiClient(network).signAndExecuteTransaction({
      transaction: tx,
      signer: this.kp,
      include: { effects: true, events: true, objectTypes: true },
    });
    if (result.$kind !== "Transaction") {
      throw new Error(
        `tx execution failed: ${JSON.stringify(result.FailedTransaction?.status)}`,
      );
    }
    const txn = result.Transaction;
    const effects = txn.effects;
    if (!effects) throw new Error("tx execution returned no effects");
    return {
      digest: txn.digest,
      effects,
      events: txn.events ?? [],
      objectTypes: txn.objectTypes ?? {},
    };
  }

  async signTransaction(bytes: Uint8Array): Promise<{ signature: string }> {
    const { signature } = await this.kp.signTransaction(bytes);
    return { signature };
  }
}

// ---------------------------------------------------------------------------
// Provider loaders
// ---------------------------------------------------------------------------

function loadEnvSeed(): Uint8Array {
  const hex = env.HOT_WALLET_SUI_SECRET_HEX;
  if (!hex) {
    throw new Error(
      "HOT_WALLET_PROVIDER=env requires HOT_WALLET_SUI_SECRET_HEX",
    );
  }
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length !== 64) {
    throw new Error(
      `HOT_WALLET_SUI_SECRET_HEX must be 32 bytes (64 hex chars); got ${stripped.length}`,
    );
  }
  return Uint8Array.from(Buffer.from(stripped, "hex"));
}

async function loadAwsKmsSeed(): Promise<Uint8Array> {
  const ct = env.HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64;
  if (!ct) {
    throw new Error(
      "HOT_WALLET_PROVIDER=aws-kms requires HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64",
    );
  }
  const client = new KMSClient(
    env.HOT_WALLET_KMS_REGION ? { region: env.HOT_WALLET_KMS_REGION } : {},
  );
  const ciphertextBlob = Uint8Array.from(Buffer.from(ct, "base64"));
  const out = await client.send(
    new DecryptCommand({
      CiphertextBlob: ciphertextBlob,
      // KeyId is encoded into the ciphertext blob; passing it explicitly
      // lets KMS reject ciphertext signed under a different key
      // (defence against ciphertext substitution by a stolen role).
      // Skip when not configured so operators can rotate the wrapping
      // key without redeploying.
      ...(env.HOT_WALLET_KMS_KEY_ID
        ? { KeyId: env.HOT_WALLET_KMS_KEY_ID }
        : {}),
    }),
  );
  client.destroy();
  if (!out.Plaintext || out.Plaintext.length !== 32) {
    throw new Error(
      `KMS decrypt returned ${out.Plaintext?.length ?? 0} bytes; expected 32`,
    );
  }
  return Uint8Array.from(out.Plaintext);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _hot: HotWallet | undefined;
let _warming: Promise<HotWallet> | undefined;

async function loadHotWalletInternal(): Promise<HotWallet> {
  const provider = env.HOT_WALLET_PROVIDER;
  const seed = provider === "aws-kms" ? await loadAwsKmsSeed() : loadEnvSeed();
  const wallet = new Ed25519HotWallet(seed);
  // Wipe the seed from this scope; `Ed25519Keypair` keeps its own
  // internal copy but we don't keep the buffer reachable from here.
  seed.fill(0);
  return wallet;
}

/**
 * Boot-time warmup. Resolves the provider (which may be async, e.g.
 * KMS decrypt) and caches the wallet so synchronous `getHotWallet()`
 * works for the rest of the process lifetime.
 */
export async function warmHotWallet(): Promise<HotWallet> {
  if (_hot) return _hot;
  if (!_warming) {
    _warming = loadHotWalletInternal().then((w) => {
      _hot = w;
      log.info(
        { address: w.address(), provider: env.HOT_WALLET_PROVIDER },
        "hot wallet initialised",
      );
      return w;
    });
  }
  return _warming;
}

export function getHotWallet(): HotWallet {
  if (!_hot) {
    throw new Error(
      "hot wallet not warmed: call warmHotWallet() during boot before using getHotWallet()",
    );
  }
  return _hot;
}

export function isHotWalletConfigured(): boolean {
  return env.HOT_WALLET_PROVIDER === "aws-kms"
    ? Boolean(env.HOT_WALLET_SUI_SECRET_KMS_CIPHERTEXT_B64)
    : Boolean(env.HOT_WALLET_SUI_SECRET_HEX);
}

/** Test-only: drop the cached instance so a fresh secret takes effect. */
export function _resetHotWalletForTest(): void {
  _hot = undefined;
  _warming = undefined;
}
