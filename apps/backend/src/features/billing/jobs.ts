/**
 * Billing background jobs.
 *
 *   `billing.sweep`        drains a user's deposit address; updates the
 *                          deposit row's sweep_* columns on success
 *
 *   `billing.sweep-retry`  periodic backfill: re-enqueues any deposit
 *                          stuck in pending/failed past the threshold,
 *                          catches sweeps lost to transient RPC blips
 */
import { and, inArray, lt } from "drizzle-orm";
import type { IkaNetwork } from "@/config/env";
import { log } from "@/config/log";
import {
  markDepositSweepFailed,
  markDepositSwept,
  sweepUserAddress,
} from "@/features/billing/sweep";
import { getDb } from "@/shared/db/client";
import { billingDeposits } from "@/shared/db/schema";
import { enqueue, registerHandler } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";

export async function registerBillingJobs(): Promise<void> {
  await registerHandler(JOBS.billingSweep, async (payload) => {
    log.info(
      { userId: payload.userId, network: payload.network },
      "billing.sweep: start",
    );
    try {
      const result = await sweepUserAddress(payload.userId, payload.network);
      if (payload.depositId && result.status === "swept" && result.digest) {
        await markDepositSwept(payload.depositId, result.digest);
      }
      log.info(
        { userId: payload.userId, network: payload.network, ...result },
        "billing.sweep: done",
      );
    } catch (err) {
      if (payload.depositId) {
        await markDepositSweepFailed(payload.depositId, String(err));
      }
      throw err; // pg-boss retries.
    }
  });

  await registerHandler(JOBS.billingSweepRetry, async (payload) => {
    const cutoff = new Date(Date.now() - payload.olderThanSec * 1000);
    const stuck = await getDb()
      .select({
        id: billingDeposits.id,
        userId: billingDeposits.userId,
        network: billingDeposits.network,
      })
      .from(billingDeposits)
      .where(
        and(
          inArray(billingDeposits.sweepStatus, ["pending", "failed"]),
          lt(billingDeposits.createdAt, cutoff),
        ),
      )
      .limit(50);
    if (stuck.length === 0) return;
    log.info({ count: stuck.length }, "billing.sweep-retry: re-enqueueing");
    // Dedupe by (userId, network) since one sweep drains a per-network address.
    const seen = new Set<string>();
    for (const s of stuck) {
      const key = `${s.userId}:${s.network}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await enqueue(JOBS.billingSweep, {
        userId: s.userId,
        network: s.network as IkaNetwork,
      });
    }
  });
}
