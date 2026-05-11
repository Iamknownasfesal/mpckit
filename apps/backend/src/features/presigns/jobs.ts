/**
 * Presign pool background jobs.
 *
 *   `presigns.refill`         mints a batch of `count` caps for the
 *                             requested `(curve, sig_algo)` bucket
 *   `presigns.sweep-expired`  rolls back stale `allocated` /
 *                             `consumed_pending` rows + promotes
 *                             ready-on-chain `pending` rows to `ready`
 */
import { log } from "@/config/log";
import {
  promotePending,
  refill,
  sweepExpired,
} from "@/features/presigns/service";
import { registerHandler } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";

export async function registerPresignJobs(): Promise<void> {
  await registerHandler(JOBS.presignRefill, async (payload) => {
    log.info(
      {
        network: payload.network,
        curve: payload.curve,
        sigAlgo: payload.signatureAlgorithm,
        count: payload.count,
      },
      "presigns.refill: minting",
    );
    const result = await refill({
      network: payload.network,
      curve: payload.curve,
      signatureAlgorithm: payload.signatureAlgorithm,
      count: payload.count,
    });
    log.info(result, "presigns.refill: done");
  });

  await registerHandler(JOBS.presignSweepExpired, async (payload) => {
    const sweep = await sweepExpired(payload.olderThanSec);
    const promote = await promotePending();
    if (sweep.rescued > 0 || sweep.failed > 0 || promote.promoted > 0) {
      log.info(
        {
          rescued: sweep.rescued,
          failed: sweep.failed,
          promoted: promote.promoted,
        },
        "presigns.sweep-expired: done",
      );
    }
  });
}
