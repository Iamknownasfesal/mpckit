/**
 * Reconcile sign requests that hit `SUBMIT_UNKNOWN` — the gas-pool
 * handed bytes off but the response was unreadable, so we don't know
 * whether the chain accepted the tx. The sign-job worker conservatively
 * marks both the presign row and the sign request as `failed` (and
 * refunds the user). This script ensures the safety doesn't become a
 * presign inventory leak.
 *
 *   1. Read each `signRequests` row with status=failed, errorCode=
 *      SUBMIT_UNKNOWN, presignId NOT NULL.
 *   2. Fetch the presign cap object from Sui.
 *      - exists: tx never landed → recoverable. Re-ready the presign.
 *      - missing: cap was burned → tx landed but we lost the response;
 *        signature is unrecoverable; nothing for us to do beyond the
 *        existing refund. Flag for human review.
 *   3. With `--apply`, perform the recoveries; otherwise dry-run.
 *
 * Usage:
 *   bun run apps/backend/scripts/reconcile-unknown-signs.ts            # dry-run
 *   bun run apps/backend/scripts/reconcile-unknown-signs.ts --apply
 *   bun run apps/backend/scripts/reconcile-unknown-signs.ts --since=24h
 *
 * The script is idempotent: re-running over already-recovered rows
 * skips them (presign no longer in `failed` state).
 */
import { rollbackToReady } from "@/features/presigns/service";
import { getDb } from "@/shared/db/client";
import { presigns, signRequests } from "@/shared/db/schema";
import { suiClient } from "@/shared/sui/client";
import { and, eq, gt } from "drizzle-orm";

interface Row {
  signRequestId: string;
  presignId: string;
  capObjectId: string;
  errorMessage: string | null;
  failedAt: Date;
}

interface Verdict {
  row: Row;
  state: "recoverable" | "unrecoverable" | "skip";
  reason: string;
}

async function fetchCapAlive(capObjectId: string): Promise<boolean> {
  const got = await suiClient.core.getObjects({
    objectIds: [capObjectId],
    include: { json: true },
  });
  const obj = got.objects?.[0];
  return Boolean(obj && !(obj instanceof Error));
}

function parseSinceArg(arg: string | undefined): Date | undefined {
  if (!arg) return undefined;
  const m = arg.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`bad --since "${arg}"; expected like 24h, 30m, 7d`);
  const n = Number.parseInt(m[1]!, 10);
  const u = m[2]!;
  const ms =
    u === "s"
      ? n * 1_000
      : u === "m"
        ? n * 60_000
        : u === "h"
          ? n * 3_600_000
          : n * 86_400_000;
  return new Date(Date.now() - ms);
}

async function listUnknown(since: Date | undefined): Promise<Row[]> {
  const db = getDb();
  const where = since
    ? and(
        eq(signRequests.status, "failed"),
        eq(signRequests.errorCode, "SUBMIT_UNKNOWN"),
        gt(signRequests.completedAt, since),
      )
    : and(
        eq(signRequests.status, "failed"),
        eq(signRequests.errorCode, "SUBMIT_UNKNOWN"),
      );
  const rows = await db
    .select({
      signRequestId: signRequests.id,
      presignId: signRequests.presignId,
      capObjectId: presigns.suiObjectId,
      errorMessage: signRequests.errorMessage,
      failedAt: signRequests.completedAt,
      presignStatus: presigns.status,
    })
    .from(signRequests)
    .leftJoin(presigns, eq(presigns.id, signRequests.presignId))
    .where(where);

  const out: Row[] = [];
  for (const r of rows) {
    if (!r.presignId || !r.capObjectId || !r.failedAt) continue;
    out.push({
      signRequestId: r.signRequestId,
      presignId: r.presignId,
      capObjectId: r.capObjectId,
      errorMessage: r.errorMessage,
      failedAt: r.failedAt,
    });
  }
  return out;
}

async function classify(row: Row): Promise<Verdict> {
  // Re-check the presign row — concurrent reconciles or a fresh sweep
  // may have already moved it.
  const db = getDb();
  const p = await db
    .select({ status: presigns.status })
    .from(presigns)
    .where(eq(presigns.id, row.presignId))
    .limit(1);
  if (!p[0]) return { row, state: "skip", reason: "presign row gone" };
  if (p[0].status !== "failed" && p[0].status !== "used") {
    return { row, state: "skip", reason: `presign already ${p[0].status}` };
  }

  const alive = await fetchCapAlive(row.capObjectId);
  return alive
    ? {
        row,
        state: "recoverable",
        reason: "cap still alive on chain — tx never landed",
      }
    : {
        row,
        state: "unrecoverable",
        reason: "cap burned — tx landed but signature was never observed",
      };
}

async function apply(verdict: Verdict): Promise<void> {
  if (verdict.state !== "recoverable") return;
  await rollbackToReady(
    verdict.row.presignId,
    `reconcile-unknown-signs: ${verdict.reason}`,
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = !args.has("--apply");
  const sinceArg = [...args].find((a) => a.startsWith("--since="))?.slice(8);
  const since = parseSinceArg(sinceArg);

  const rows = await listUnknown(since);
  if (rows.length === 0) {
    console.log("[reconcile] no SUBMIT_UNKNOWN rows to inspect");
    return;
  }
  console.log(
    `[reconcile] inspecting ${rows.length} row(s); ${dryRun ? "DRY-RUN" : "APPLY"}`,
  );

  let recoverable = 0;
  let unrecoverable = 0;
  let skipped = 0;
  for (const row of rows) {
    const verdict = await classify(row);
    const head = `sr=${row.signRequestId} cap=${row.capObjectId} failed=${row.failedAt.toISOString()}`;
    if (verdict.state === "skip") {
      skipped++;
      console.log(`  [skip]   ${head}  -- ${verdict.reason}`);
      continue;
    }
    if (verdict.state === "recoverable") {
      recoverable++;
      console.log(`  [RECOV]  ${head}  -- ${verdict.reason}`);
      if (!dryRun) await apply(verdict);
      continue;
    }
    unrecoverable++;
    console.log(`  [REVIEW] ${head}  -- ${verdict.reason}`);
    if (row.errorMessage) {
      console.log(`           err: ${row.errorMessage.slice(0, 200)}`);
    }
  }

  console.log("");
  console.log(
    `[reconcile] recoverable=${recoverable} unrecoverable=${unrecoverable} skipped=${skipped}`,
  );
  if (dryRun && recoverable > 0) {
    console.log(
      "[reconcile] re-run with --apply to re-ready the recoverable rows",
    );
  }
  if (unrecoverable > 0) {
    console.log(
      "[reconcile] unrecoverable rows had their tx land on chain but we never observed the sign session; the user has been refunded but should retry the sign with a fresh idempotency key",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
