import type { IkaNetwork } from "@/config/env";
import {
  OP_PRICES,
  charge as chargeCredits,
  refund as refundCredits,
} from "@/features/billing/service";
import { getDb } from "@/shared/db/client";
import { type EncryptionKey, encryptionKeys } from "@/shared/db/schema";
import { errors } from "@/shared/errors";
import { getIkaClient } from "@/shared/ika/client";
import { findFirstCreatedByType } from "@/shared/sui/effects";
import { buildRegisterEncryptionKey } from "@/shared/sui/move-calls";
import { getTxExecutor } from "@/shared/sui/tx-executor";
/**
 * Encryption-key registration. The user generates a class-groups
 * keypair from their passkey PRF off-chain, signs the public key with
 * their Ed25519 signer keypair (also PRF-derived), and posts the
 * three pieces here. We submit the PTB through the operator (paying
 * gas), and the resulting on-chain `EncryptionKey` object lands at
 * the address derived from `signerPublicKey`.
 *
 * Persisted: `(userId, curve, suiObjectId, suiAddress, suiTxDigest)`.
 * Idempotent on `(userId, curve, suiAddress)`: if the same user posts
 * the same `signerPublicKey` for the same curve, we return the
 * existing row instead of submitting a new tx. Keying on suiAddress
 * (deterministic from signerPublicKey) means seed rotations on the
 * same user+curve get a fresh row instead of silently reusing the
 * old EncryptionKey id, which would mismatch the new seed's DKG
 * crypto and surface as `MoveAbort` only at sign / accept time.
 */
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { and, eq } from "drizzle-orm";

export interface RegisterEncryptionKeyArgs {
  userId: string;
  network: IkaNetwork;
  curve: number;
  encryptionKey: Uint8Array;
  encryptionKeySignature: Uint8Array;
  signerPublicKey: Uint8Array;
}

export async function registerEncryptionKey(
  args: RegisterEncryptionKeyArgs,
): Promise<EncryptionKey> {
  const db = getDb();

  // Idempotency now on (userId, curve, suiAddress, network).
  const suiAddress = signerPubkeyToAddress(args.signerPublicKey);
  const existing = await db
    .select()
    .from(encryptionKeys)
    .where(
      and(
        eq(encryptionKeys.userId, args.userId),
        eq(encryptionKeys.curve, args.curve),
        eq(encryptionKeys.suiAddress, suiAddress),
        eq(encryptionKeys.network, args.network),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const ika = await getIkaClient(args.network);
  const cfg = ika.ikaConfig;
  const dwalletPackageId = cfg.packages.ikaDwallet2pcMpcPackage;
  const coordinatorId = cfg.objects.ikaDWalletCoordinator.objectID;

  const chargeOpId = crypto.randomUUID();
  await chargeCredits({
    userId: args.userId,
    network: args.network,
    opType: "encryption-key",
    opId: chargeOpId,
    amountMicro: BigInt(OP_PRICES["encryption-key"]),
    reason: "register encryption key",
  });

  const tx = new Transaction();
  buildRegisterEncryptionKey(tx, {
    dwalletPackageId,
    coordinatorId,
    curve: args.curve,
    encryptionKey: args.encryptionKey,
    encryptionKeySignature: args.encryptionKeySignature,
    signerPublicKey: args.signerPublicKey,
  });

  let executed: Awaited<
    ReturnType<ReturnType<typeof getTxExecutor>["execute"]>
  >;
  try {
    executed = await getTxExecutor(args.network).execute(tx);
  } catch (err) {
    await refundCredits({
      userId: args.userId,
      network: args.network,
      opType: "encryption-key",
      opId: chargeOpId,
      amountMicro: BigInt(OP_PRICES["encryption-key"]),
      reason: `register encryption key submit failed: ${String(err).slice(0, 200)}`,
    });
    throw err;
  }
  const suiObjectId = findFirstCreatedByType(executed, "::EncryptionKey");

  const inserted = await db
    .insert(encryptionKeys)
    .values({
      userId: args.userId,
      network: args.network,
      curve: args.curve,
      suiObjectId,
      suiAddress,
      suiTxDigest: executed.digest,
    })
    .returning();

  if (!inserted[0]) {
    throw errors.internal("encryption-key insert returned empty");
  }
  return inserted[0];
}

export async function listEncryptionKeys(
  userId: string,
  network: string,
): Promise<EncryptionKey[]> {
  return getDb()
    .select()
    .from(encryptionKeys)
    .where(
      and(
        eq(encryptionKeys.userId, userId),
        eq(encryptionKeys.network, network),
      ),
    )
    .orderBy(encryptionKeys.curve);
}

function signerPubkeyToAddress(pubkey: Uint8Array): string {
  return new Ed25519PublicKey(pubkey).toSuiAddress();
}
