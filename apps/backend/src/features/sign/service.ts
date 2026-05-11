import { env } from "@/config/env";
import type { IkaNetwork } from "@/config/env";
import { log } from "@/config/log";
import {
  OP_PRICES,
  charge as chargeCredits,
  refund as refundCredits,
} from "@/features/billing/service";
import {
  allocate as allocatePresign,
  markConsumedPending,
  markUsed as markPresignUsed,
  rollbackToReady,
} from "@/features/presigns/service";
import { signSubmitUnknown } from "@/shared/cache/metrics";
import { getDb } from "@/shared/db/client";
import {
  type SignRequest,
  accounts,
  dwallets,
  presigns,
  signRequests,
} from "@/shared/db/schema";
import { errors } from "@/shared/errors";
import { getIkaClient } from "@/shared/ika/client";
import {
  curveFromNumber,
  signatureAlgorithmFromNumber,
} from "@/shared/ika/curves";
import { enqueue } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";
import { getSuiClient } from "@/shared/sui/client";
import { findEvents } from "@/shared/sui/effects";
import { type Network, buildSignZeroTrust } from "@/shared/sui/move-calls";
import { TxExecutorError, getTxExecutor } from "@/shared/sui/tx-executor";
/**
 * Sign request lifecycle. Two-phase API because the user's centralized
 * signature is bound to a specific presign's bytes; the user must know
 * which presign they're signing against before they sign.
 *
 *   `prepareSignRequest`  validates inputs, allocates a presign from
 *                          the pool, creates a `prepared` row, charges
 *                          credits, returns the presign bytes the user
 *                          must sign over.
 *
 *   `submitPreparedSign`  takes the centralized signature + session id
 *                          the user produced, transitions the row to
 *                          `queued`, enqueues the worker job.
 *
 *   `getSignRequest`      status query for the SDK to poll.
 *
 *   `processSignJob`      worker entry. Pre-allocated presign is on
 *                          the row. Builds the PTB via `TxExecutor`,
 *                          parses sign_id from the SignRequested event,
 *                          long-polls the coordinator for the completed
 *                          signature, persists, marks presign used.
 *                          Refunds credits + rolls back presign on
 *                          failure. Triggers a refill of the consumed
 *                          bucket so the pool stays warm.
 *
 * Status transitions:
 *   prepared → queued → submitted → completed
 *                              \-> failed
 *   prepared -- (TTL) --> failed   (sweep rescues stuck rows)
 */
import { Transaction } from "@mysten/sui/transactions";
import { and, eq, lt } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Phase 1: prepare
// ---------------------------------------------------------------------------

export interface PrepareSignArgs {
  userId: string;
  network: IkaNetwork;
  idempotencyKey: string;
  /** dwallets.id (uuid). */
  dwalletId: string;
  signatureAlgorithm: number;
  hashScheme: number;
  message: Uint8Array;
}

export interface PrepareSignResult {
  signRequest: SignRequest;
  duplicate: boolean;
  /** Hex-encoded presign bytes the user signs the centralized message over. */
  presignBytesHex: string;
  presignSuiObjectId: string;
}

export async function prepareSignRequest(
  args: PrepareSignArgs,
): Promise<PrepareSignResult> {
  const db = getDb();

  // Idempotency: same (userId, network, idempotencyKey) returns the
  // existing record + presign bytes. The bytes never change for a given
  // presign so a retried prepare is a pure read.
  const existing = await db
    .select()
    .from(signRequests)
    .where(
      and(
        eq(signRequests.userId, args.userId),
        eq(signRequests.network, args.network),
        eq(signRequests.idempotencyKey, args.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing[0]?.presignId) {
    const presignRow = await db
      .select()
      .from(presigns)
      .where(eq(presigns.id, existing[0].presignId))
      .limit(1);
    if (presignRow[0]) {
      const bytes = await fetchPresignBytes(
        args.network,
        presignRow[0].suiObjectId,
      );
      return {
        signRequest: existing[0],
        duplicate: true,
        presignBytesHex: toHex(bytes),
        presignSuiObjectId: presignRow[0].suiObjectId,
      };
    }
  }

  const dwRows = await db
    .select()
    .from(dwallets)
    .where(
      and(
        eq(dwallets.id, args.dwalletId),
        eq(dwallets.userId, args.userId),
        eq(dwallets.network, args.network),
      ),
    )
    .limit(1);
  const dw = dwRows[0];
  if (!dw) throw errors.notFound("dwallet not found", "DWALLET_NOT_FOUND");
  if (dw.status !== "active") {
    throw errors.unprocessable(
      `dwallet status ${dw.status} cannot sign yet`,
      "DWALLET_NOT_ACTIVE",
    );
  }

  // Insert the prepared row first so allocate has a stable opId.
  const inserted = await db
    .insert(signRequests)
    .values({
      userId: args.userId,
      network: args.network,
      idempotencyKey: args.idempotencyKey,
      suiDwalletId: dw.suiDwalletId,
      curve: dw.curve,
      signatureAlgorithm: args.signatureAlgorithm,
      hashScheme: args.hashScheme,
      messageHex: toHex(args.message),
      status: "prepared",
    })
    .returning();
  const row = inserted[0]!;

  const presignAlloc = await allocatePresign({
    network: args.network,
    curve: dw.curve,
    signatureAlgorithm: args.signatureAlgorithm,
    signRequestId: row.id,
  });
  if (!presignAlloc) {
    // Drop the prepared row; sweep would catch it but a clean delete
    // keeps the user-visible state consistent.
    await db.delete(signRequests).where(eq(signRequests.id, row.id));
    await enqueue(JOBS.presignRefill, {
      network: args.network,
      curve: dw.curve,
      signatureAlgorithm: args.signatureAlgorithm,
      count: env.PRESIGN_BATCH_SIZE,
    });
    throw errors.unprocessable(
      "presign pool empty; retry shortly",
      "PRESIGN_POOL_EMPTY",
    );
  }

  const updated = await db
    .update(signRequests)
    .set({ presignId: presignAlloc.id, updatedAt: new Date() })
    .where(eq(signRequests.id, row.id))
    .returning();

  // Charge upfront. Refund happens on permanent failure or TTL sweep.
  await chargeCredits({
    userId: args.userId,
    network: args.network,
    opType: "sign",
    opId: row.id,
    amountMicro: BigInt(OP_PRICES.sign),
    reason: "sign request prepared",
  });

  const presignBytes = await fetchPresignBytes(
    args.network,
    presignAlloc.suiObjectId,
  );

  return {
    signRequest: updated[0]!,
    duplicate: false,
    presignBytesHex: toHex(presignBytes),
    presignSuiObjectId: presignAlloc.suiObjectId,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: submit
// ---------------------------------------------------------------------------

export interface SubmitPreparedSignArgs {
  userId: string;
  network: IkaNetwork;
  signRequestId: string;
  messageCentralizedSignature: Uint8Array;
  sessionIdentifierBytes: Uint8Array;
}

export async function submitPreparedSign(
  args: SubmitPreparedSignArgs,
): Promise<SignRequest> {
  const db = getDb();
  const rows = await db
    .select()
    .from(signRequests)
    .where(
      and(
        eq(signRequests.id, args.signRequestId),
        eq(signRequests.userId, args.userId),
        eq(signRequests.network, args.network),
      ),
    )
    .limit(1);
  const sr = rows[0];
  if (!sr) throw errors.notFound("sign request not found", "SIGN_NOT_FOUND");

  // Idempotent: a retried submit on an already-finalized row returns
  // the current state without touching the queue or DB.
  if (
    sr.status === "queued" ||
    sr.status === "submitted" ||
    sr.status === "completed"
  ) {
    return sr;
  }
  if (sr.status !== "prepared") {
    throw errors.unprocessable(
      `sign request status ${sr.status} cannot be finalized`,
      "SIGN_BAD_STATE",
    );
  }
  if (!sr.presignId) {
    throw errors.internal("prepared row has no presign id", "SIGN_NO_PRESIGN");
  }

  const updated = await db
    .update(signRequests)
    .set({
      messageCentralizedSignatureHex: toHex(args.messageCentralizedSignature),
      sessionIdentifierHex: toHex(args.sessionIdentifierBytes),
      status: "queued",
      updatedAt: new Date(),
    })
    .where(eq(signRequests.id, sr.id))
    .returning();

  await enqueue(
    JOBS.signProcess,
    { signRequestId: sr.id },
    {
      singletonKey: sr.id,
    },
  );

  return updated[0]!;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getSignRequest(
  userId: string,
  network: string,
  signRequestId: string,
): Promise<SignRequest | undefined> {
  const rows = await getDb()
    .select()
    .from(signRequests)
    .where(
      and(
        eq(signRequests.id, signRequestId),
        eq(signRequests.userId, userId),
        eq(signRequests.network, network),
      ),
    )
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const COORDINATOR_POLL_TIMEOUT_MS = 120_000;

export async function processSignJob(signRequestId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(signRequests)
    .where(eq(signRequests.id, signRequestId))
    .limit(1);
  const sr = rows[0];
  if (!sr) {
    log.warn({ signRequestId }, "sign.process: row not found, dropping");
    return;
  }
  if (sr.status === "completed" || sr.status === "failed") {
    return; // Already settled.
  }
  if (sr.status !== "queued") {
    log.warn(
      { signRequestId, status: sr.status },
      "sign.process: unexpected status, dropping",
    );
    return;
  }

  if (!sr.presignId) {
    await markFailed(sr.id, null, "NO_PRESIGN", "row has no presign id");
    return;
  }
  if (!sr.messageCentralizedSignatureHex || !sr.sessionIdentifierHex) {
    await markFailed(
      sr.id,
      sr.presignId,
      "MISSING_INPUTS",
      "centralized sig / session id absent on row",
    );
    return;
  }

  const presignRows = await db
    .select()
    .from(presigns)
    .where(eq(presigns.id, sr.presignId))
    .limit(1);
  const presignRow = presignRows[0];
  if (!presignRow) {
    await markFailed(sr.id, null, "PRESIGN_GONE", "presign row missing");
    return;
  }

  const inputs = {
    messageCentralizedSignature: fromHex(sr.messageCentralizedSignatureHex),
    sessionIdentifierBytes: fromHex(sr.sessionIdentifierHex),
  };

  const srNetwork = sr.network as IkaNetwork;
  const ika = await getIkaClient(srNetwork);
  const coordinatorId = ika.ikaConfig.objects.ikaDWalletCoordinator.objectID;

  const dwRows = await db
    .select()
    .from(dwallets)
    .where(eq(dwallets.suiDwalletId, sr.suiDwalletId))
    .limit(1);
  const dw = dwRows[0];
  if (!dw) {
    await markFailed(
      sr.id,
      sr.presignId,
      "DWALLET_GONE",
      "dwallet row vanished",
    );
    return;
  }
  const accountSuiId = await accountSuiObjectIdFor(dw.accountId);

  const tx = new Transaction();
  buildSignZeroTrust(tx, {
    network: sr.network as Network,
    accountId: accountSuiId,
    coordinatorId,
    dwalletId: sr.suiDwalletId,
    presignCapId: presignRow.suiObjectId,
    signatureAlgorithm: sr.signatureAlgorithm,
    hashScheme: sr.hashScheme,
    message: fromHex(sr.messageHex),
    messageCentralizedSignature: inputs.messageCentralizedSignature,
    sessionIdentifierBytes: inputs.sessionIdentifierBytes,
  });

  let executed: Awaited<
    ReturnType<ReturnType<typeof getTxExecutor>["execute"]>
  >;
  try {
    executed = await getTxExecutor(srNetwork).execute(tx);
  } catch (err) {
    // Only re-ready the presign when we can prove the chain never
    // touched the cap. `preflight` (reserve_gas / build / sign threw)
    // and `reverted` (Move abort, atomic rollback) are both safe.
    // `unknown` covers HTTP failures after submit, where the tx may
    // have actually landed and burned the cap — re-readying that row
    // would surface as PRESIGN_CAP_GONE on the next allocation.
    const phase = err instanceof TxExecutorError ? err.phase : "unknown";
    if (phase === "preflight" || phase === "reverted") {
      await rollbackToReady(sr.presignId, `sign tx ${phase}`);
      await markFailed(sr.id, sr.presignId, "SUBMIT_FAILED", String(err));
    } else {
      // Tx state unknown: assume the cap is consumed so we don't
      // poison the pool. Operator must reconcile via the digest in
      // the error (see `scripts/reconcile-unknown-signs.ts`); the
      // counter feeds an alert.
      signSubmitUnknown.inc();
      await markPresignUsed(sr.presignId);
      await markFailed(sr.id, sr.presignId, "SUBMIT_UNKNOWN", String(err));
    }
    throw err;
  }

  await markConsumedPending(sr.presignId);
  await db
    .update(signRequests)
    .set({
      status: "submitted",
      txDigest: executed.digest,
      updatedAt: new Date(),
    })
    .where(eq(signRequests.id, sr.id));

  const signSessionId = extractSignId(executed);
  if (!signSessionId) {
    await markPresignUsed(sr.presignId); // tx succeeded; cap is consumed.
    await markFailed(sr.id, null, "NO_SIGN_ID", "no SignRequested event in tx");
    return;
  }

  await db
    .update(signRequests)
    .set({ signSessionId, updatedAt: new Date() })
    .where(eq(signRequests.id, sr.id));

  let signature: Uint8Array;
  try {
    const curve = curveFromNumber(sr.curve);
    const signatureAlgorithm = signatureAlgorithmFromNumber(
      curve,
      sr.signatureAlgorithm,
    );
    const completed = await ika.getSignInParticularState(
      signSessionId,
      curve,
      signatureAlgorithm,
      "Completed",
      { timeout: COORDINATOR_POLL_TIMEOUT_MS },
    );
    signature = readCompletedSignature(completed);
  } catch (err) {
    await markPresignUsed(sr.presignId);
    await markFailed(sr.id, null, "COORDINATOR_TIMEOUT", String(err));
    throw err;
  }

  await markPresignUsed(sr.presignId);
  await db
    .update(signRequests)
    .set({
      status: "completed",
      signatureHex: toHex(signature),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(signRequests.id, sr.id));

  // Top up the bucket we just drained.
  await enqueue(JOBS.presignRefill, {
    network: sr.network as IkaNetwork,
    curve: sr.curve,
    signatureAlgorithm: sr.signatureAlgorithm,
    count: 1,
  });
}

// ---------------------------------------------------------------------------
// Sweep stuck `prepared` rows
// ---------------------------------------------------------------------------

/**
 * Rescue sign requests stuck in `prepared` past `olderThanSec`: refund
 * the upfront charge, roll the presign back to `ready`, and mark the
 * row `failed`. Avoids leaking presign pool inventory when a user
 * never calls phase 2.
 */
export async function sweepStuckPrepared(
  olderThanSec: number,
): Promise<{ rescued: number }> {
  const cutoff = new Date(Date.now() - olderThanSec * 1000);
  const stuck = await getDb()
    .select()
    .from(signRequests)
    .where(
      and(
        eq(signRequests.status, "prepared"),
        lt(signRequests.updatedAt, cutoff),
      ),
    );
  if (stuck.length === 0) return { rescued: 0 };

  for (const sr of stuck) {
    if (sr.presignId) {
      await rollbackToReady(sr.presignId, "prepared sign request expired");
    }
    await markFailed(
      sr.id,
      null,
      "PREPARE_EXPIRED",
      "phase 2 not submitted in time",
    );
  }
  log.info(
    { rescued: stuck.length, olderThanSec },
    "sign.sweep-prepared: rescued",
  );
  return { rescued: stuck.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchPresignBytes(
  network: IkaNetwork,
  capObjectId: string,
): Promise<Uint8Array> {
  const ika = await getIkaClient(network);
  // DB stores the cap id; SDK's presign queries want the session id.
  const got = await getSuiClient(network).core.getObjects({
    objectIds: [capObjectId],
    include: { json: true },
  });
  const obj = got.objects?.[0];
  if (!obj || obj instanceof Error) {
    // Quarantine the row so the next allocation skips it. A missing
    // cap means it was already consumed on chain, the row should
    // never have been re-readied.
    await getDb()
      .update(presigns)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(presigns.suiObjectId, capObjectId));
    throw errors.internal(
      `could not fetch cap ${capObjectId}`,
      "PRESIGN_CAP_GONE",
    );
  }
  const sessionId = (obj.json as { presign_id?: string })?.presign_id;
  if (!sessionId) {
    throw errors.internal(
      `cap ${capObjectId} has no presign_id`,
      "PRESIGN_BAD_CAP",
    );
  }
  const completed = await ika.getPresignInParticularState(
    sessionId,
    "Completed",
    { timeout: 30_000, interval: 1_000 },
  );
  const bytes = (
    completed as { state?: { Completed?: { presign?: Uint8Array | number[] } } }
  ).state?.Completed?.presign;
  if (bytes instanceof Uint8Array) return bytes;
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  throw errors.internal("completed presign has no bytes", "PRESIGN_BAD_SHAPE");
}

async function accountSuiObjectIdFor(
  accountId: string | null,
): Promise<string> {
  if (!accountId) {
    throw errors.internal(
      "dwallet missing account link",
      "ACCOUNT_LINK_MISSING",
    );
  }
  const rows = await getDb()
    .select({ suiObjectId: accounts.suiObjectId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!rows[0]) throw errors.internal("account row missing", "ACCOUNT_GONE");
  return rows[0].suiObjectId;
}

function extractSignId(
  executed: Awaited<ReturnType<ReturnType<typeof getTxExecutor>["execute"]>>,
): string | undefined {
  const ours = findEvents(executed, "::sign::SignRequested");
  for (const ev of ours) {
    const id = ev.json?.sign_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

function readCompletedSignature(completed: unknown): Uint8Array {
  const sig = (
    completed as {
      state?: { Completed?: { signature?: Uint8Array | number[] } };
    }
  ).state?.Completed?.signature;
  if (sig instanceof Uint8Array) return sig;
  if (Array.isArray(sig)) return Uint8Array.from(sig);
  throw errors.internal(
    "completed sign has no signature bytes",
    "SIGN_BAD_SHAPE",
  );
}

async function markFailed(
  signRequestId: string,
  presignId: string | null,
  code: string,
  message: string,
): Promise<void> {
  const failed = await getDb()
    .update(signRequests)
    .set({
      status: "failed",
      errorCode: code,
      errorMessage: message.slice(0, 1024),
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(signRequests.id, signRequestId))
    .returning({
      userId: signRequests.userId,
      network: signRequests.network,
    });
  if (failed[0]) {
    await refundCredits({
      userId: failed[0].userId,
      network: failed[0].network,
      opType: "sign",
      opId: signRequestId,
      amountMicro: BigInt(OP_PRICES.sign),
      reason: `sign failed: ${code}`,
    });
  }
  if (presignId) {
    await getDb()
      .update(presigns)
      .set({ updatedAt: new Date() })
      .where(eq(presigns.id, presignId));
  }
  log.warn({ signRequestId, code, message }, "sign request failed");
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function fromHex(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "hex"));
}
