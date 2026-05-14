/**
 * Presign pool. Operator wallet holds `UnverifiedPresignCap` objects;
 * we mirror their state in Postgres so multiple backend pods can
 * allocate atomically without racing on Sui object versions.
 *
 * State machine:
 *   `pending`          minted on chain, may not yet be valid
 *                      (`coordinator.is_presign_valid` may return false
 *                      for a brief window). Sweep promotes to `ready`.
 *   `ready`            available for sign workers to allocate.
 *   `allocated`        held for a sign request; PTB not yet submitted.
 *   `consumed_pending` PTB submitted; awaiting Sui finality + sign result.
 *   `used`             consumed by a successful sign.
 *   `failed`           coordinator rejected, or stuck pending past TTL.
 *
 * Allocation uses `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` so two
 * concurrent workers never grab the same row. Failures roll back to
 * `ready` so a presign isn't lost when a sign tx errors.
 *
 * Sweep policy: only `allocated` rows are eligible to be re-readied.
 * A `consumed_pending` row past TTL means the PTB hit the chain (cap
 * is burned or the sign is still grinding through MPC); re-readying
 * it would hand a stale cap to the next allocator and surface as
 * `PRESIGN_CAP_GONE`. Park those in `failed` instead.
 */
import { randomBytes } from "node:crypto";
import { Transaction } from "@mysten/sui/transactions";
import { and, eq, lt, sql } from "drizzle-orm";
import { env, type IkaNetwork } from "@/config/env";
import { log } from "@/config/log";
import { getDb } from "@/shared/db/client";
import { rowsOf } from "@/shared/db/raw";
import { type Presign, presigns } from "@/shared/db/schema";
import { errors } from "@/shared/errors";
import { getIkaClient } from "@/shared/ika/client";
import { getSuiClient } from "@/shared/sui/client";
import { findCreatedOwnedBy } from "@/shared/sui/effects";
import { buildPresignBatch } from "@/shared/sui/move-calls";
import { getTxExecutor } from "@/shared/sui/tx-executor";

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

/**
 * Atomically claim one `ready` presign for `signRequestId`. Returns
 * `undefined` if the bucket is empty (caller decides to wait, retry,
 * or trigger a refill).
 */
export async function allocate(args: {
  network: IkaNetwork;
  curve: number;
  signatureAlgorithm: number;
  signRequestId: string;
}): Promise<Presign | undefined> {
  // Raw UPDATE … SELECT FOR UPDATE SKIP LOCKED for atomic claim across
  // pods. We can't use Drizzle's typed update for this because it doesn't
  // support correlated subqueries with row-locking. We pull just the id
  // back, then re-select via the typed builder so the caller gets a
  // camelCase `Presign`.
  const claimed = await getDb().execute<{ id: string }>(sql`
    UPDATE ${presigns}
    SET status = 'allocated',
        sign_request_id = ${args.signRequestId},
        allocated_at = NOW(),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM ${presigns}
      WHERE network = ${args.network}
        AND curve = ${args.curve}
        AND signature_algorithm = ${args.signatureAlgorithm}
        AND status = 'ready'
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const id = rowsOf<{ id: string }>(claimed)[0]?.id;
  if (!id) return undefined;
  const typed = await getDb()
    .select()
    .from(presigns)
    .where(eq(presigns.id, id))
    .limit(1);
  return typed[0];
}

export async function markConsumedPending(presignId: string): Promise<void> {
  await getDb()
    .update(presigns)
    .set({ status: "consumed_pending", updatedAt: new Date() })
    .where(eq(presigns.id, presignId));
}

export async function markUsed(presignId: string): Promise<void> {
  await getDb()
    .update(presigns)
    .set({ status: "used", usedAt: new Date(), updatedAt: new Date() })
    .where(eq(presigns.id, presignId));
}

export async function rollbackToReady(
  presignId: string,
  reason: string,
): Promise<void> {
  await getDb()
    .update(presigns)
    .set({
      status: "ready",
      signRequestId: null,
      allocatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(presigns.id, presignId));
  log.info({ presignId, reason }, "presign rolled back to ready");
}

// ---------------------------------------------------------------------------
// Pool health
// ---------------------------------------------------------------------------

export interface BucketHealth {
  network: string;
  curve: number;
  signatureAlgorithm: number;
  ready: number;
  allocated: number;
  consumedPending: number;
  pending: number;
  used: number;
  failed: number;
}

export async function bucketHealth(
  network: string,
  curve: number,
  signatureAlgorithm: number,
): Promise<BucketHealth> {
  const result = await getDb().execute<{
    status: string;
    n: string;
  }>(sql`
    SELECT status, COUNT(*)::text AS n
    FROM ${presigns}
    WHERE network = ${network}
      AND curve = ${curve}
      AND signature_algorithm = ${signatureAlgorithm}
    GROUP BY status
  `);
  const rows = rowsOf<{ status: string; n: string }>(result);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = Number.parseInt(r.n, 10);
  return {
    network,
    curve,
    signatureAlgorithm,
    ready: counts.ready ?? 0,
    allocated: counts.allocated ?? 0,
    consumedPending: counts.consumed_pending ?? 0,
    pending: counts.pending ?? 0,
    used: counts.used ?? 0,
    failed: counts.failed ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Refill
// ---------------------------------------------------------------------------

export interface RefillArgs {
  network: IkaNetwork;
  curve: number;
  signatureAlgorithm: number;
  /** How many caps to mint in this single PTB. Capped at PRESIGN_BATCH_SIZE. */
  count?: number;
}

/**
 * Mint `count` `UnverifiedPresignCap` objects via a single PTB and
 * insert one `pending` row per cap. The `sweepReady` job (or first
 * `verify_presign_cap` consumer) promotes them to `ready`.
 */
export async function refill(
  args: RefillArgs,
): Promise<{ minted: number; txDigest: string }> {
  const count = Math.min(
    args.count ?? env.PRESIGN_BATCH_SIZE,
    env.PRESIGN_BATCH_SIZE,
  );
  if (count <= 0) return { minted: 0, txDigest: "" };

  const ika = await getIkaClient(args.network);
  const coordinatorId = ika.ikaConfig.objects.ikaDWalletCoordinator.objectID;
  const networkKey = await ika.getLatestNetworkEncryptionKey();
  const networkEncryptionKeyId = networkKey.id;

  const executor = getTxExecutor(args.network);
  const recipient = executor.signerAddress();

  const sessionIdentifiers = Array.from({ length: count }, () =>
    randomBytes(32),
  );

  const tx = new Transaction();
  buildPresignBatch(tx, {
    network: args.network,
    coordinatorId,
    dwalletNetworkEncryptionKeyId: networkEncryptionKeyId,
    curve: args.curve,
    signatureAlgorithm: args.signatureAlgorithm,
    count,
    recipient,
    sessionIdentifiers,
  });

  const executed = await executor.execute(tx);

  const capIds = findCreatedOwnedBy(
    executed,
    recipient,
    "UnverifiedPresignCap",
  );
  if (capIds.length === 0) {
    throw errors.internal(
      "presign refill: no UnverifiedPresignCap objects in effects",
      "PRESIGN_REFILL_NO_CAPS",
    );
  }

  await getDb()
    .insert(presigns)
    .values(
      capIds.map((suiObjectId) => ({
        suiObjectId,
        network: args.network,
        curve: args.curve,
        signatureAlgorithm: args.signatureAlgorithm,
        networkEncryptionKeyId,
        status: "pending" as const,
        requestTxDigest: executed.digest,
      })),
    );

  log.info(
    {
      curve: args.curve,
      sigAlgo: args.signatureAlgorithm,
      minted: capIds.length,
      txDigest: executed.digest,
    },
    "presigns minted",
  );
  return { minted: capIds.length, txDigest: executed.digest };
}

/**
 * Promote `pending` rows whose underlying caps are valid on chain to
 * `ready`. The coordinator's `is_presign_valid` is the truth source.
 * Called by the sweep job; cheap if there are no pending rows.
 */
export async function promotePending(): Promise<{ promoted: number }> {
  const db = getDb();
  const pending = await db
    .select()
    .from(presigns)
    .where(eq(presigns.status, "pending"));
  if (pending.length === 0) return { promoted: 0 };

  let promoted = 0;
  for (const row of pending) {
    try {
      const net = row.network as IkaNetwork;
      const ika = await getIkaClient(net);
      // The DB stores the `UnverifiedPresignCap` id; the SDK's presign
      // queries want the underlying `PresignSession` id. Follow the
      // cap's `presign_id` field on chain to resolve.
      const sessionId = await resolveSessionId(net, row.suiObjectId);
      await ika.getPresignInParticularState(sessionId, "Completed", {
        timeout: 2_000,
        interval: 500,
      });
      await db
        .update(presigns)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(presigns.id, row.id));
      promoted++;
    } catch (err) {
      // Not yet completed (timeout) or transient RPC error — leave
      // pending and let the next sweep retry.
      log.debug(
        { err, suiObjectId: row.suiObjectId },
        "presign promote: not ready yet",
      );
    }
  }
  return { promoted };
}

/**
 * Read the on-chain cap and return its `presign_id` (the session id).
 * Cached implicitly via the SDK's object cache.
 */
async function resolveSessionId(
  network: IkaNetwork,
  capObjectId: string,
): Promise<string> {
  const got = await getSuiClient(network).core.getObjects({
    objectIds: [capObjectId],
    include: { json: true },
  });
  const obj = got.objects?.[0];
  if (!obj || obj instanceof Error) {
    throw new Error(`could not fetch cap ${capObjectId}`);
  }
  const sessionId = (obj.json as { presign_id?: string })?.presign_id;
  if (!sessionId) {
    throw new Error(`cap ${capObjectId} has no presign_id field`);
  }
  return sessionId;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Page size for `listOwnedObjects`. The Sui gRPC server caps this at
 * 50; going higher silently truncates.
 */
const DISCOVER_PAGE_SIZE = 50;

/**
 * Per-network minimum delay between cap-resolution RPCs. The public
 * Mysten fullnode throttles aggressive sweepers, so we cap effective
 * throughput at ~10 requests/sec while still finishing a 1k-cap pass
 * in well under 30s.
 */
const DISCOVER_RPC_INTERVAL_MS = 100;

/** Substring that identifies an `UnverifiedPresignCap` Move type tag. */
const UNVERIFIED_PRESIGN_CAP_TYPE = "::coordinator_inner::UnverifiedPresignCap";

/**
 * Move field name (as raw bytes) the coordinator attaches to a
 * `PresignSession` via `dynamic_field::add(..., b"dwallet_network_encryption_key_id", id)`.
 * Reading this back is the canonical way to get the NEK a presign is
 * bound to: `validate_and_initiate_sign` removes the same field and
 * asserts it matches the dwallet's NEK at sign time.
 */
const NEK_DYNAMIC_FIELD_NAME = "dwallet_network_encryption_key_id";

export interface DiscoverResult {
  scanned: number;
  alreadyTracked: number;
  inserted: number;
  failed: number;
}

/** Shape we need from `PresignSession` content JSON for reconciliation. */
interface PresignSessionJson {
  id?: { id?: string } | string;
  curve?: number;
  signature_algorithm?: number;
}

/** Resolved per-cap metadata read straight off the chain. */
interface CapInfo {
  presignId: string;
  curve: number;
  signatureAlgorithm: number;
  networkEncryptionKeyId: string;
}

/**
 * Scan the operator wallet for `UnverifiedPresignCap` objects and
 * back-fill any whose row is missing from `presigns`. Handles caps
 * created out-of-band (operator scripts, prior deployments) so the
 * DB-tracked pool catches up with what the chain actually holds.
 *
 * For each cap we resolve `(curve, signatureAlgorithm, NEK)` straight
 * off chain:
 *   - presign_id comes from the cap object's content fields,
 *   - curve + signature_algorithm come from the `PresignSession`
 *     regular fields (batched 50/req),
 *   - NEK comes from the `PresignSession`'s
 *     `b"dwallet_network_encryption_key_id"` dynamic field, which is
 *     the same source `validate_and_initiate_sign` reads at sign time.
 *
 * Per-cap failures (RPC blips, missing dynamic field) are counted as
 * `failed` and retried on the next pass; one bad cap never sinks the
 * whole sweep.
 */
export async function discover(network: IkaNetwork): Promise<DiscoverResult> {
  const operator = getTxExecutor(network).signerAddress();
  const sui = getSuiClient(network);
  const db = getDb();

  // Pull every `UnverifiedPresignCap` owned by the operator. The
  // optional `type` filter on `listOwnedObjects` requires the fully
  // qualified type tag (package id + module + struct), which varies
  // across mpckitcore deployments; filter client-side instead so caps
  // minted by older packages still get reconciled.
  const capIds: string[] = [];
  let cursor: string | null | undefined;
  while (true) {
    const page = await sui.core.listOwnedObjects({
      owner: operator,
      limit: DISCOVER_PAGE_SIZE,
      cursor: cursor ?? null,
    });
    for (const obj of page.objects) {
      if (obj.type.includes(UNVERIFIED_PRESIGN_CAP_TYPE)) {
        capIds.push(obj.objectId);
      }
    }
    if (!page.hasNextPage) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  const scanned = capIds.length;

  // Pre-load the set of already-tracked cap ids in one shot. With ~1k
  // caps this is a ~30KB result, far cheaper than 1k point lookups.
  const tracked = scanned
    ? await db
        .select({ suiObjectId: presigns.suiObjectId })
        .from(presigns)
        .where(eq(presigns.network, network))
    : [];
  const trackedSet = new Set(tracked.map((r) => r.suiObjectId));

  const untrackedCapIds = capIds.filter((id) => !trackedSet.has(id));
  let alreadyTracked = scanned - untrackedCapIds.length;
  let inserted = 0;
  let failed = 0;

  if (untrackedCapIds.length === 0) {
    log.info(
      { network, scanned, alreadyTracked, inserted, failed },
      "presigns.discover: done",
    );
    return { scanned, alreadyTracked, inserted, failed };
  }

  // Batch the cap-content fetch by 50 (the gRPC server's `getObjects`
  // limit) so we collect `presign_id` for every untracked cap in a
  // small number of round trips. Caps whose content can't be fetched
  // are dropped here and counted as failed below.
  const capPresignId = new Map<string, string>();
  const failedCapIds = new Set<string>();
  for (let i = 0; i < untrackedCapIds.length; i += DISCOVER_PAGE_SIZE) {
    const batch = untrackedCapIds.slice(i, i + DISCOVER_PAGE_SIZE);
    try {
      const got = await sui.core.getObjects({
        objectIds: batch,
        include: { json: true },
      });
      for (let j = 0; j < batch.length; j++) {
        const capId = batch[j]!;
        const obj = got.objects?.[j];
        if (!obj || obj instanceof Error) {
          failedCapIds.add(capId);
          continue;
        }
        const presignId = (obj.json as { presign_id?: string } | null)
          ?.presign_id;
        if (!presignId) {
          failedCapIds.add(capId);
          continue;
        }
        capPresignId.set(capId, presignId);
      }
    } catch (err) {
      log.debug(
        { err, network, batchStart: i },
        "presigns.discover: cap batch fetch failed",
      );
      for (const id of batch) failedCapIds.add(id);
    }
  }

  // Batch the session content fetch the same way. `curve` and
  // `signature_algorithm` live on the `PresignSession` itself.
  const sessionInfo = new Map<
    string,
    { curve: number; signatureAlgorithm: number }
  >();
  const presignIds = Array.from(new Set(capPresignId.values()));
  for (let i = 0; i < presignIds.length; i += DISCOVER_PAGE_SIZE) {
    const batch = presignIds.slice(i, i + DISCOVER_PAGE_SIZE);
    try {
      const got = await sui.core.getObjects({
        objectIds: batch,
        include: { json: true },
      });
      for (let j = 0; j < batch.length; j++) {
        const sessionId = batch[j]!;
        const obj = got.objects?.[j];
        if (!obj || obj instanceof Error) continue;
        const json = obj.json as PresignSessionJson | null;
        if (
          json &&
          typeof json.curve === "number" &&
          typeof json.signature_algorithm === "number"
        ) {
          sessionInfo.set(sessionId, {
            curve: json.curve,
            signatureAlgorithm: json.signature_algorithm,
          });
        }
      }
    } catch (err) {
      log.debug(
        { err, network, batchStart: i },
        "presigns.discover: session batch fetch failed",
      );
    }
  }

  for (const capId of untrackedCapIds) {
    if (failedCapIds.has(capId)) {
      failed++;
      continue;
    }
    try {
      const presignId = capPresignId.get(capId);
      if (!presignId) {
        throw new Error(`cap ${capId} has no presign_id`);
      }
      const session = sessionInfo.get(presignId);
      if (!session) {
        throw new Error(
          `presign session ${presignId} content missing curve/signature_algorithm`,
        );
      }
      const networkEncryptionKeyId = await readNekFromDynamicField(
        network,
        presignId,
      );

      const info: CapInfo = {
        presignId,
        curve: session.curve,
        signatureAlgorithm: session.signatureAlgorithm,
        networkEncryptionKeyId,
      };

      // Insert as `pending`; the existing `promotePending` cron promotes
      // it to `ready` on the next sweep.
      const out = await db
        .insert(presigns)
        .values({
          suiObjectId: capId,
          network,
          curve: info.curve,
          signatureAlgorithm: info.signatureAlgorithm,
          networkEncryptionKeyId: info.networkEncryptionKeyId,
          status: "pending" as const,
          requestTxDigest: null,
        })
        .onConflictDoNothing({ target: presigns.suiObjectId })
        .returning({ id: presigns.id });

      if (out.length === 0) {
        // Another writer landed first (boot warmup + cron racing on a
        // freshly-minted cap). Treat as already tracked.
        alreadyTracked++;
      } else {
        inserted++;
      }
    } catch (err) {
      log.debug(
        { err, suiObjectId: capId, network },
        "presigns.discover: skipping cap, will retry next pass",
      );
      failed++;
    }
    if (DISCOVER_RPC_INTERVAL_MS > 0) {
      await new Promise((r) => setTimeout(r, DISCOVER_RPC_INTERVAL_MS));
    }
  }

  log.info(
    { network, scanned, alreadyTracked, inserted, failed },
    "presigns.discover: done",
  );
  return { scanned, alreadyTracked, inserted, failed };
}

/**
 * Read the `b"dwallet_network_encryption_key_id"` dynamic field off a
 * `PresignSession` and return the NEK id (Sui object id) it carries.
 * Throws if the field is absent or unreadable; the caller treats the
 * cap as failed and retries next pass.
 */
async function readNekFromDynamicField(
  network: IkaNetwork,
  presignId: string,
): Promise<string> {
  const sui = getSuiClient(network);
  // The dynamic field name in Move is `vector<u8>` containing the raw
  // ASCII bytes of the field name. BCS-encoding a `vector<u8>` prefixes
  // the byte payload with a ULEB128 length.
  const nameBytes = new TextEncoder().encode(NEK_DYNAMIC_FIELD_NAME);
  const nameBcs = encodeVectorU8(nameBytes);

  const got = await sui.core.getDynamicField({
    parentId: presignId,
    name: { type: "vector<u8>", bcs: nameBcs },
  });
  const value = got.dynamicField?.value;
  if (!value?.bcs || value.bcs.length === 0) {
    throw new Error(`dynamic field empty for presign ${presignId}`);
  }
  // The value is a Move `ID`, which is BCS-encoded as a 32-byte address.
  return toHexAddress(value.bcs);
}

/** Minimal BCS encoder for `vector<u8>` (ULEB128 length + raw bytes). */
function encodeVectorU8(bytes: Uint8Array): Uint8Array {
  const lenBytes: number[] = [];
  let n = bytes.length;
  while (n >= 0x80) {
    lenBytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  lenBytes.push(n);
  const out = new Uint8Array(lenBytes.length + bytes.length);
  out.set(lenBytes, 0);
  out.set(bytes, lenBytes.length);
  return out;
}

/** 32-byte Sui address from BCS-encoded `ID` -> `0x`-prefixed hex. */
function toHexAddress(bcs: Uint8Array): string {
  let hex = "";
  for (const b of bcs) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/**
 * Reclaim presigns whose worker likely died:
 *
 *   `allocated`         PTB never made it on chain; the cap is still
 *                       valid → re-ready so the pool isn't leaked.
 *   `consumed_pending`  PTB was submitted on chain; the cap is burned
 *                       (or the sign request is winding through MPC).
 *                       Re-readying a `consumed_pending` row was the
 *                       source of `PRESIGN_CAP_GONE` failures: the
 *                       next allocator would grab the row, fetch the
 *                       cap, and find it deleted on chain. Park these
 *                       in `failed` instead so they exit the pool.
 */
export async function sweepExpired(
  olderThanSec: number,
): Promise<{ rescued: number; failed: number }> {
  const cutoff = new Date(Date.now() - olderThanSec * 1000);
  const db = getDb();

  const rescued = await db
    .update(presigns)
    .set({
      status: "ready",
      signRequestId: null,
      allocatedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(presigns.status, "allocated"), lt(presigns.allocatedAt, cutoff)),
    )
    .returning({ id: presigns.id });

  const failed = await db
    .update(presigns)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(presigns.status, "consumed_pending"),
        lt(presigns.allocatedAt, cutoff),
      ),
    )
    .returning({ id: presigns.id });

  if (rescued.length > 0 || failed.length > 0) {
    log.info(
      { rescued: rescued.length, failed: failed.length, olderThanSec },
      "presigns swept",
    );
  }
  return { rescued: rescued.length, failed: failed.length };
}
