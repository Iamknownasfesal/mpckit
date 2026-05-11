/**
 * Sign worker. Wires `sign.process` to `processSignJob` so the worker
 * pod picks up queued sign requests and drives them to completion.
 *
 * Also wires the periodic `sign.sweep-prepared` rescue: rolls back
 * presigns and refunds credits on `prepared` rows whose phase 2 never
 * arrived in time.
 */
import { log } from "@/config/log";
import { processSignJob, sweepStuckPrepared } from "@/features/sign/service";
import { registerHandler } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";

export async function registerSignJobs(): Promise<void> {
  await registerHandler(JOBS.signProcess, async (payload) => {
    log.info({ signRequestId: payload.signRequestId }, "sign.process: start");
    await processSignJob(payload.signRequestId);
  });

  await registerHandler(JOBS.signSweepPrepared, async (payload) => {
    const result = await sweepStuckPrepared(payload.olderThanSec);
    if (result.rescued > 0) {
      log.info({ rescued: result.rescued }, "sign.sweep-prepared: done");
    }
  });
}
