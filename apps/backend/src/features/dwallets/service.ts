/**
 * dWallet lifecycle. Two operations:
 *
 *   `onboardZeroTrust` — creates a new zero-trust dWallet for the
 *     caller. If the user has no `Account` shared object yet, the same
 *     PTB registers + DKGs + shares (single round-trip). Otherwise
 *     it's a single-call DKG against the existing account. Returns
 *     the new dwallet (`status = awaiting_user_share`); caller polls
 *     coordinator gRPC for completion, then submits via `accept`.
 *
 *   `acceptUserShare` — finalises a dwallet by attesting to the
 *     network-encrypted user share. Coordinator verifies the
 *     `userOutputSignature` against the dwallet's public output;
 *     Move-level gate is just dwallet membership.
 *
 * Idempotency: `onboardZeroTrust` is *not* idempotent (each call
 * creates a new dwallet). Clients deduplicate at the request layer
 * (e.g. retry guards) since the cryptographic inputs are unique per
 * DKG anyway.
 */
import { CoordinatorInnerModule, SessionsManagerModule } from "@ika.xyz/sdk";
import { Transaction } from "@mysten/sui/transactions";
import { and, eq } from "drizzle-orm";
import { findAccountForUser, recordAccount } from "@/features/accounts/service";
import {
  charge as chargeCredits,
  OP_PRICES,
  refund as refundCredits,
} from "@/features/billing/service";
import { getDb } from "@/shared/db/client";
import {
  accounts,
  type DWallet,
  dwallets,
  encryptionKeys,
} from "@/shared/db/schema";
import { errors } from "@/shared/errors";
import { getIkaClient } from "@/shared/ika/client";
import { findEvents, findFirstCreatedByType } from "@/shared/sui/effects";
import type { ExecutedTx } from "@/shared/sui/hot-wallet";
import {
  buildAcceptUserShare,
  buildAddDwalletZeroTrust,
  buildOnboardZeroTrust,
  type Network,
} from "@/shared/sui/move-calls";
import { getTxExecutor } from "@/shared/sui/tx-executor";

export interface OnboardZeroTrustArgs {
  userId: string;
  network: Network;
  /** uuid of an `encryption_keys` row already registered for this user. */
  encryptionKeyId: string;
  /** Network encryption key id the DKG is bound to. */
  dwalletNetworkEncryptionKeyId: string;
  centralizedPublicKeyShareAndProof: Uint8Array;
  encryptedCentralizedSecretShareAndProof: Uint8Array;
  userPublicOutput: Uint8Array;
  signerPublicKey: Uint8Array;
  sessionIdentifierBytes: Uint8Array;
}

export interface OnboardResult {
  account: { id: string; suiObjectId: string; createdInThisTx: boolean };
  dwallet: DWallet;
  txDigest: string;
  /**
   * Coordinator-side encrypted-user-share id parsed from DKG events.
   * The accept step needs this id; surfacing it on the onboard response
   * spares the SDK from re-fetching + parsing BCS off the chain.
   */
  encryptedUserSecretKeyShareId: string;
}

export async function onboardZeroTrust(
  args: OnboardZeroTrustArgs,
): Promise<OnboardResult> {
  const db = getDb();

  const ekRows = await db
    .select()
    .from(encryptionKeys)
    .where(
      and(
        eq(encryptionKeys.id, args.encryptionKeyId),
        eq(encryptionKeys.userId, args.userId),
        eq(encryptionKeys.network, args.network),
      ),
    )
    .limit(1);
  const ek = ekRows[0];
  if (!ek) {
    throw errors.notFound(
      "encryption key not found",
      "ENCRYPTION_KEY_NOT_FOUND",
    );
  }

  const ika = await getIkaClient(args.network);
  const coordinatorId = ika.ikaConfig.objects.ikaDWalletCoordinator.objectID;
  const existing = await findAccountForUser(args.userId, args.network);

  // Charge before submit. opId is a freshly-minted uuid so the charge
  // is uniquely identifiable in the billing ledger; we surface it in
  // logs for traceability but don't persist it on the dwallet row,
  // since the row may not exist if submit fails.
  const chargeOpId = crypto.randomUUID();
  await chargeCredits({
    userId: args.userId,
    network: args.network,
    opType: "dwallet.dkg",
    opId: chargeOpId,
    amountMicro: BigInt(OP_PRICES["dwallet.dkg"]),
    reason: "zero-trust DKG",
  });

  const tx = new Transaction();
  if (existing) {
    buildAddDwalletZeroTrust(tx, {
      network: args.network,
      accountId: existing.suiObjectId,
      coordinatorId,
      dwalletNetworkEncryptionKeyId: args.dwalletNetworkEncryptionKeyId,
      curve: ek.curve,
      centralizedPublicKeyShareAndProof: args.centralizedPublicKeyShareAndProof,
      encryptedCentralizedSecretShareAndProof:
        args.encryptedCentralizedSecretShareAndProof,
      encryptionKeyAddress: ek.suiAddress,
      userPublicOutput: args.userPublicOutput,
      signerPublicKey: args.signerPublicKey,
      sessionIdentifierBytes: args.sessionIdentifierBytes,
    });
  } else {
    buildOnboardZeroTrust(tx, {
      network: args.network,
      coordinatorId,
      dwalletNetworkEncryptionKeyId: args.dwalletNetworkEncryptionKeyId,
      curve: ek.curve,
      centralizedPublicKeyShareAndProof: args.centralizedPublicKeyShareAndProof,
      encryptedCentralizedSecretShareAndProof:
        args.encryptedCentralizedSecretShareAndProof,
      encryptionKeyAddress: ek.suiAddress,
      userPublicOutput: args.userPublicOutput,
      signerPublicKey: args.signerPublicKey,
      sessionIdentifierBytes: args.sessionIdentifierBytes,
    });
  }

  let executed: Awaited<
    ReturnType<ReturnType<typeof getTxExecutor>["execute"]>
  >;
  try {
    executed = await getTxExecutor(args.network).execute(tx);
  } catch (err) {
    await refundCredits({
      userId: args.userId,
      network: args.network,
      opType: "dwallet.dkg",
      opId: chargeOpId,
      amountMicro: BigInt(OP_PRICES["dwallet.dkg"]),
      reason: `DKG submit failed: ${String(err).slice(0, 200)}`,
    });
    throw err;
  }

  const accountRow = existing
    ? existing
    : await recordAccount({
        userId: args.userId,
        network: args.network,
        suiObjectId: findFirstCreatedByType(executed, "::account::Account"),
        suiTxDigest: executed.digest,
      });

  const dwalletId = extractDwalletId(executed);
  const encryptedUserSecretKeyShareId = extractEncryptedShareId(executed);

  const dwInserted = await db
    .insert(dwallets)
    .values({
      userId: args.userId,
      network: args.network,
      accountId: accountRow.id,
      suiDwalletId: dwalletId,
      curve: ek.curve,
      encryptionKeyId: args.dwalletNetworkEncryptionKeyId,
      kind: "zero_trust",
      status: "awaiting_user_share",
      dkgTxDigest: executed.digest,
    })
    .returning();
  const dwallet = dwInserted[0];
  if (!dwallet) throw errors.internal("dwallet insert returned empty");

  return {
    account: {
      id: accountRow.id,
      suiObjectId: accountRow.suiObjectId,
      createdInThisTx: !existing,
    },
    dwallet,
    txDigest: executed.digest,
    encryptedUserSecretKeyShareId,
  };
}

export interface AcceptUserShareArgs {
  userId: string;
  network: Network;
  /** dwallets.id (uuid). */
  dwalletId: string;
  /** Coordinator-side encrypted-user-share id (fetched off-chain by client). */
  encryptedUserSecretKeyShareId: string;
  /** User's signature over the dwallet's public output. */
  userOutputSignature: Uint8Array;
}

export async function acceptUserShare(
  args: AcceptUserShareArgs,
): Promise<DWallet> {
  const db = getDb();

  const joined = await db
    .select({ dwallet: dwallets, accountSuiId: accounts.suiObjectId })
    .from(dwallets)
    .innerJoin(accounts, eq(dwallets.accountId, accounts.id))
    .where(
      and(
        eq(dwallets.id, args.dwalletId),
        eq(dwallets.userId, args.userId),
        eq(dwallets.network, args.network),
      ),
    )
    .limit(1);
  const found = joined[0];
  if (!found) throw errors.notFound("dwallet not found", "DWALLET_NOT_FOUND");
  const dw = found.dwallet;

  if (dw.status === "active") return dw;
  if (dw.status !== "awaiting_user_share") {
    throw errors.unprocessable(
      `dwallet status ${dw.status} cannot be accepted`,
      "DWALLET_BAD_STATE",
    );
  }

  const ika = await getIkaClient(args.network);
  const coordinatorId = ika.ikaConfig.objects.ikaDWalletCoordinator.objectID;

  const tx = new Transaction();
  buildAcceptUserShare(tx, {
    network: args.network,
    accountId: found.accountSuiId,
    coordinatorId,
    dwalletId: dw.suiDwalletId,
    encryptedUserSecretKeyShareId: args.encryptedUserSecretKeyShareId,
    userOutputSignature: args.userOutputSignature,
  });

  const executed = await getTxExecutor(args.network).execute(tx);

  const updated = await db
    .update(dwallets)
    .set({
      status: "active",
      acceptTxDigest: executed.digest,
      updatedAt: new Date(),
    })
    .where(eq(dwallets.id, dw.id))
    .returning();
  return updated[0]!;
}

export async function listDwalletsForUser(
  userId: string,
  network: string,
): Promise<DWallet[]> {
  return getDb()
    .select()
    .from(dwallets)
    .where(and(eq(dwallets.userId, userId), eq(dwallets.network, network)))
    .orderBy(dwallets.createdAt);
}

export async function getDwalletForUser(
  userId: string,
  network: string,
  dwalletId: string,
): Promise<DWallet | undefined> {
  const rows = await getDb()
    .select()
    .from(dwallets)
    .where(
      and(
        eq(dwallets.id, dwalletId),
        eq(dwallets.userId, userId),
        eq(dwallets.network, network),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Read the on-chain dwallet object's public output. Used by the Rust
 * SDK (which doesn't talk to Sui directly) so it can sign over the
 * dwallet's network-finalised public output during onboard's accept
 * step and during sign. Polls until the network reaches the requested
 * state, then returns the bytes hex-encoded.
 */
export async function fetchDwalletOnchainState(
  network: Network,
  suiDwalletId: string,
  state: "AwaitingKeyHolderSignature" | "Active",
  timeoutMs: number,
): Promise<{ publicOutputHex: string }> {
  const ika = await getIkaClient(network);
  const dw = await ika.getDWalletInParticularState(suiDwalletId, state, {
    timeout: timeoutMs,
    interval: 2_000,
  });
  const publicOutput =
    state === "Active"
      ? (dw.state as { Active: { public_output: number[] } }).Active
          .public_output
      : (
          dw.state as {
            AwaitingKeyHolderSignature: { public_output: number[] };
          }
        ).AwaitingKeyHolderSignature.public_output;
  const bytes = new Uint8Array(publicOutput);
  return { publicOutputHex: Buffer.from(bytes).toString("hex") };
}

/**
 * Pull the on-chain dwallet id out of coordinator events. Different
 * coordinator versions emit slightly different event names; we match
 * any event whose `parsedJson.dwallet_id` field is set.
 */
function extractDwalletId(tx: ExecutedTx): string {
  const decoded = decodeDKGEvent(tx);
  if (decoded) return decoded.event_data.dwallet_id;
  throw errors.internal(
    "could not extract dwallet_id from tx events",
    "DWALLET_ID_NOT_FOUND",
  );
}

/**
 * Pull the encrypted-user-share id from the DKG event. Coordinator
 * stuffs it inside the `user_secret_key_share` enum's `Encrypted`
 * variant — there is no top-level `encrypted_user_secret_key_share_id`
 * on the event itself.
 */
function extractEncryptedShareId(tx: ExecutedTx): string {
  const decoded = decodeDKGEvent(tx);
  // user_secret_key_share is an enum: { Encrypted: { … } } | { Plain: { … } }
  const enc = (
    decoded?.event_data.user_secret_key_share as unknown as {
      Encrypted?: { encrypted_user_secret_key_share_id?: string };
    }
  )?.Encrypted?.encrypted_user_secret_key_share_id;
  if (typeof enc === "string" && enc.length > 0) return enc;
  throw errors.internal(
    "could not extract encrypted_user_secret_key_share_id from DKG event",
    "ENCRYPTED_SHARE_ID_NOT_FOUND",
  );
}

/**
 * BCS-decode the wrapped `DWalletSessionEvent<DWalletDKGRequestEvent>`
 * from a tx. gRPC events ship `bcs` bytes; the JSON variant of the
 * payload isn't reliably populated, so we go through BCS — that's the
 * approach the upstream SDK recommends and matches infinite_idol's
 * production path.
 */
function decodeDKGEvent(tx: ExecutedTx) {
  for (const ev of findEvents(tx, "DWalletDKGRequestEvent")) {
    if (!ev.bcs) continue;
    return SessionsManagerModule.DWalletSessionEvent(
      CoordinatorInnerModule.DWalletDKGRequestEvent,
    ).parse(new Uint8Array(ev.bcs));
  }
  return undefined;
}
