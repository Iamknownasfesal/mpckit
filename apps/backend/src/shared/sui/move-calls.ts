/**
 * Programmable-tx-block builders for the deployed `mpckitcore` Move
 * package.
 *
 * Each protocol op resolves to one Move call on `mpckitcore::treasury`,
 * which pays the ika fees from the operator-funded treasury and routes
 * the call into the right ika entrypoint. Operators cannot pull coins
 * out of the treasury directly; the only outflow paths are these
 * `pay_*` entries (bounded by per-op caps stored on the treasury) and
 * the admin-only `drain`.
 *
 * Required env per network: a deployed `mpckitcore` package id, plus
 * the `OperatorCap` / `AdminCap` / `Treasury` object ids minted at
 * publish.
 */
import type { Transaction } from "@mysten/sui/transactions";
import { env } from "@/config/env";

export type Network = "testnet" | "mainnet";

/** Schemes match `mpckitcore::auth`. */
export const Scheme = {
  Ed25519: 0,
  Secp256k1: 1,
  Secp256r1: 2,
  WebAuthn: 3,
  SenderAddress: 4,
} as const;
export type Scheme = (typeof Scheme)[keyof typeof Scheme];

function requireEnv(name: keyof typeof env, hint: string): string {
  const v = env[name];
  if (!v || typeof v !== "string") {
    throw new Error(`${name} is not configured: ${hint}`);
  }
  return v;
}

function packageId(network: Network): string {
  const key =
    network === "mainnet"
      ? "MPCKITCORE_MAINNET_PACKAGE_ID"
      : "MPCKITCORE_TESTNET_PACKAGE_ID";
  return requireEnv(
    key,
    "publish mpckitcore for this network and set the env var",
  );
}

function operatorCapId(network: Network): string {
  const key =
    network === "mainnet"
      ? "MPCKITCORE_MAINNET_OPERATOR_CAP_ID"
      : "MPCKITCORE_TESTNET_OPERATOR_CAP_ID";
  return requireEnv(
    key,
    "mint an OperatorCap with the AdminCap and set the env var",
  );
}

function treasuryId(network: Network): string {
  const key =
    network === "mainnet"
      ? "MPCKITCORE_MAINNET_TREASURY_ID"
      : "MPCKITCORE_TESTNET_TREASURY_ID";
  return requireEnv(
    key,
    "the Treasury shared object is published with the package",
  );
}

function adminCapId(network: Network): string {
  const key =
    network === "mainnet"
      ? "MPCKITCORE_MAINNET_ADMIN_CAP_ID"
      : "MPCKITCORE_TESTNET_ADMIN_CAP_ID";
  return requireEnv(key, "the AdminCap is owned by the deployer key");
}

// ============================================================================
// Encryption-key registration (coordinator-direct, no treasury involvement)
// ============================================================================

export interface RegisterEncryptionKeyInput {
  /** Package id of `ika_dwallet_2pc_mpc` (from `ikaClient.ikaConfig`). */
  dwalletPackageId: string;
  /** Coordinator shared object id. */
  coordinatorId: string;
  curve: number;
  encryptionKey: Uint8Array;
  encryptionKeySignature: Uint8Array;
  signerPublicKey: Uint8Array;
}

export function buildRegisterEncryptionKey(
  tx: Transaction,
  input: RegisterEncryptionKeyInput,
): Transaction {
  tx.moveCall({
    target: `${input.dwalletPackageId}::coordinator::register_encryption_key`,
    arguments: [
      tx.object(input.coordinatorId),
      tx.pure.u32(input.curve),
      tx.pure.vector("u8", Array.from(input.encryptionKey)),
      tx.pure.vector("u8", Array.from(input.encryptionKeySignature)),
      tx.pure.vector("u8", Array.from(input.signerPublicKey)),
    ],
  });
  return tx;
}

// ============================================================================
// Onboard: register account + zero-trust DKG (one PTB, one move call)
// ============================================================================

export interface OnboardZeroTrustInput {
  network: Network;
  coordinatorId: string;
  dwalletNetworkEncryptionKeyId: string;
  curve: number;
  centralizedPublicKeyShareAndProof: Uint8Array;
  encryptedCentralizedSecretShareAndProof: Uint8Array;
  encryptionKeyAddress: string;
  userPublicOutput: Uint8Array;
  signerPublicKey: Uint8Array;
  sessionIdentifierBytes: Uint8Array;
}

export function buildOnboardZeroTrust(
  tx: Transaction,
  input: OnboardZeroTrustInput,
): Transaction {
  tx.moveCall({
    target: `${packageId(input.network)}::treasury::pay_register_and_dkg_zero_trust`,
    arguments: [
      tx.object(treasuryId(input.network)),
      tx.object(operatorCapId(input.network)),
      tx.object(input.coordinatorId),
      tx.pure.id(input.dwalletNetworkEncryptionKeyId),
      tx.pure.u32(input.curve),
      tx.pure.vector("u8", Array.from(input.centralizedPublicKeyShareAndProof)),
      tx.pure.vector(
        "u8",
        Array.from(input.encryptedCentralizedSecretShareAndProof),
      ),
      tx.pure.address(input.encryptionKeyAddress),
      tx.pure.vector("u8", Array.from(input.userPublicOutput)),
      tx.pure.vector("u8", Array.from(input.signerPublicKey)),
      tx.pure.vector("u8", Array.from(input.sessionIdentifierBytes)),
    ],
  });
  return tx;
}

// ============================================================================
// Add another zero-trust dWallet to an existing shared Account
// ============================================================================

export interface AddDwalletZeroTrustInput extends OnboardZeroTrustInput {
  /** Shared Account object id. */
  accountId: string;
}

export function buildAddDwalletZeroTrust(
  tx: Transaction,
  input: AddDwalletZeroTrustInput,
): Transaction {
  tx.moveCall({
    target: `${packageId(input.network)}::treasury::pay_dkg_zero_trust`,
    arguments: [
      tx.object(treasuryId(input.network)),
      tx.object(operatorCapId(input.network)),
      tx.object(input.accountId),
      tx.object(input.coordinatorId),
      tx.pure.id(input.dwalletNetworkEncryptionKeyId),
      tx.pure.u32(input.curve),
      tx.pure.vector("u8", Array.from(input.centralizedPublicKeyShareAndProof)),
      tx.pure.vector(
        "u8",
        Array.from(input.encryptedCentralizedSecretShareAndProof),
      ),
      tx.pure.address(input.encryptionKeyAddress),
      tx.pure.vector("u8", Array.from(input.userPublicOutput)),
      tx.pure.vector("u8", Array.from(input.signerPublicKey)),
      tx.pure.vector("u8", Array.from(input.sessionIdentifierBytes)),
    ],
  });
  return tx;
}

// ============================================================================
// Accept user share (no fees, coordinator-direct via dkg.move)
// ============================================================================

export interface AcceptUserShareInput {
  network: Network;
  accountId: string;
  coordinatorId: string;
  dwalletId: string;
  encryptedUserSecretKeyShareId: string;
  userOutputSignature: Uint8Array;
}

export function buildAcceptUserShare(
  tx: Transaction,
  input: AcceptUserShareInput,
): Transaction {
  tx.moveCall({
    target: `${packageId(input.network)}::dkg::accept_user_share`,
    arguments: [
      tx.object(input.accountId),
      tx.object(input.coordinatorId),
      tx.pure.id(input.dwalletId),
      tx.pure.id(input.encryptedUserSecretKeyShareId),
      tx.pure.vector("u8", Array.from(input.userOutputSignature)),
    ],
  });
  return tx;
}

// ============================================================================
// Presign batch: one PTB looping N x `treasury::pay_presign`
// ============================================================================

export interface PresignBatchInput {
  network: Network;
  coordinatorId: string;
  dwalletNetworkEncryptionKeyId: string;
  curve: number;
  signatureAlgorithm: number;
  count: number;
  recipient: string;
  /** One unique session id per cap; `count` long. */
  sessionIdentifiers: Uint8Array[];
}

export function buildPresignBatch(
  tx: Transaction,
  input: PresignBatchInput,
): Transaction {
  if (input.sessionIdentifiers.length !== input.count) {
    throw new Error(
      `sessionIdentifiers length ${input.sessionIdentifiers.length} != count ${input.count}`,
    );
  }
  const pkg = packageId(input.network);
  const treasury = tx.object(treasuryId(input.network));
  const opCap = tx.object(operatorCapId(input.network));
  const coord = tx.object(input.coordinatorId);
  for (let i = 0; i < input.count; i++) {
    const sessionBytes = input.sessionIdentifiers[i];
    if (!sessionBytes) {
      throw new Error(`sessionIdentifiers[${i}] missing`);
    }
    tx.moveCall({
      target: `${pkg}::treasury::pay_presign`,
      arguments: [
        treasury,
        opCap,
        coord,
        tx.pure.id(input.dwalletNetworkEncryptionKeyId),
        tx.pure.u32(input.curve),
        tx.pure.u32(input.signatureAlgorithm),
        tx.pure.vector("u8", Array.from(sessionBytes)),
        tx.pure.address(input.recipient),
      ],
    });
  }
  return tx;
}

// ============================================================================
// Sign zero-trust: consume a presign cap, produce a signature
// ============================================================================

export interface SignZeroTrustInput {
  network: Network;
  accountId: string;
  coordinatorId: string;
  dwalletId: string;
  /** Owned `UnverifiedPresignCap` object id from the operator's pool. */
  presignCapId: string;
  signatureAlgorithm: number;
  hashScheme: number;
  message: Uint8Array;
  messageCentralizedSignature: Uint8Array;
  sessionIdentifierBytes: Uint8Array;
}

export function buildSignZeroTrust(
  tx: Transaction,
  input: SignZeroTrustInput,
): Transaction {
  tx.moveCall({
    target: `${packageId(input.network)}::treasury::pay_sign_zero_trust`,
    arguments: [
      tx.object(treasuryId(input.network)),
      tx.object(operatorCapId(input.network)),
      tx.object(input.accountId),
      tx.object(input.coordinatorId),
      tx.pure.id(input.dwalletId),
      tx.object(input.presignCapId),
      tx.pure.u32(input.signatureAlgorithm),
      tx.pure.u32(input.hashScheme),
      tx.pure.vector("u8", Array.from(input.message)),
      tx.pure.vector("u8", Array.from(input.messageCentralizedSignature)),
      tx.pure.vector("u8", Array.from(input.sessionIdentifierBytes)),
    ],
  });
  return tx;
}

// ============================================================================
// Funding (open: anyone may deposit)
// ============================================================================

export function buildDepositIka(
  tx: Transaction,
  network: Network,
  ikaCoinId: string,
): Transaction {
  tx.moveCall({
    target: `${packageId(network)}::treasury::deposit_ika`,
    arguments: [tx.object(treasuryId(network)), tx.object(ikaCoinId)],
  });
  return tx;
}

export function buildDepositSui(
  tx: Transaction,
  network: Network,
  suiCoinId: string,
): Transaction {
  tx.moveCall({
    target: `${packageId(network)}::treasury::deposit_sui`,
    arguments: [tx.object(treasuryId(network)), tx.object(suiCoinId)],
  });
  return tx;
}

// ============================================================================
// Admin
// ============================================================================

export function buildDrainTreasury(
  tx: Transaction,
  network: Network,
  recipient: string,
): Transaction {
  const result = tx.moveCall({
    target: `${packageId(network)}::treasury::drain`,
    arguments: [tx.object(treasuryId(network)), tx.object(adminCapId(network))],
  });
  tx.transferObjects([result[0]!, result[1]!], tx.pure.address(recipient));
  return tx;
}

export function buildMintOperator(
  tx: Transaction,
  network: Network,
  recipient: string,
): Transaction {
  tx.moveCall({
    target: `${packageId(network)}::acl::mint_operator`,
    arguments: [tx.object(adminCapId(network)), tx.pure.address(recipient)],
  });
  return tx;
}

export function buildBurnOperator(
  tx: Transaction,
  network: Network,
  operatorCapObjectId: string,
): Transaction {
  tx.moveCall({
    target: `${packageId(network)}::acl::burn_operator`,
    arguments: [tx.object(adminCapId(network)), tx.object(operatorCapObjectId)],
  });
  return tx;
}
