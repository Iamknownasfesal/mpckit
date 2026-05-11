import { env } from "@/config/env";
import { log } from "@/config/log";
import type { JobName, PayloadFor } from "@/shared/queue/types";
/**
 * pg-boss bootstrap (v12 API).
 *
 * Single shared instance reused by API pods (which only enqueue) and
 * worker pods (which also handle jobs). Lifecycle:
 *
 *   - `getBoss()`        : lazy-init + start, returns a singleton
 *   - `closeBoss()`      : graceful shutdown
 *   - `enqueue(name, p)` : type-safe enqueue helper
 *   - `registerHandler`  : create queue + register handler
 *   - `schedule`         : type-safe recurring job
 *
 * pg-boss creates its own `pgboss` schema in the same Postgres DB.
 * No Redis needed; horizontal scaling works via row-level locking.
 */
import { type Job, PgBoss, type WorkOptions } from "pg-boss";

let _boss: PgBoss | undefined;
let _starting: Promise<PgBoss> | undefined;
const _queuesEnsured = new Set<string>();

export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  if (_starting) return _starting;
  if (!env.DATABASE_URL) {
    throw new Error("queue: DATABASE_URL required for pg-boss");
  }
  _starting = (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: "pgboss",
    });
    boss.on("error", (err: unknown) => {
      log.error({ err }, "pg-boss error");
    });
    await boss.start();
    log.info("pg-boss started");
    return boss;
  })();
  _boss = await _starting;
  _starting = undefined;
  return _boss;
}

export async function closeBoss(): Promise<void> {
  if (_boss) {
    await _boss.stop({ graceful: true });
    _boss = undefined;
    _queuesEnsured.clear();
    log.info("pg-boss stopped");
  }
}

/**
 * v12 requires `createQueue` before `send` / `work`. We make it
 * idempotent + cached so callers don't have to think about it.
 */
async function ensureQueue(name: string): Promise<void> {
  if (_queuesEnsured.has(name)) return;
  const boss = await getBoss();
  await boss.createQueue(name, {
    retryLimit: 5,
    retryBackoff: true,
  });
  _queuesEnsured.add(name);
}

/** Enqueue a job with a type-checked payload. */
export async function enqueue<N extends JobName>(
  name: N,
  payload: PayloadFor<N>,
  options?: { startAfter?: Date | string | number; singletonKey?: string },
): Promise<string | null> {
  const boss = await getBoss();
  await ensureQueue(name);
  return boss.send(name, payload as object, options ?? {});
}

/**
 * Schedule a recurring job via pg-boss cron. Idempotent: re-registering
 * the same name just updates the schedule.
 */
export async function schedule<N extends JobName>(
  name: N,
  cron: string,
  payload: PayloadFor<N>,
): Promise<void> {
  const boss = await getBoss();
  await ensureQueue(name);
  await boss.schedule(name, cron, payload as object);
}

/**
 * Register a handler. v12 hands an array of jobs (batch); we iterate
 * and run each one through the user's handler. `localConcurrency`
 * controls per-pod parallelism for this queue.
 */
export async function registerHandler<N extends JobName>(
  name: N,
  handler: (payload: PayloadFor<N>) => Promise<void>,
  opts: { localConcurrency?: number; pollingIntervalSeconds?: number } = {},
): Promise<string> {
  const boss = await getBoss();
  await ensureQueue(name);
  const workOpts: WorkOptions = {
    localConcurrency: opts.localConcurrency ?? 1,
    pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 1,
  };
  return boss.work(name, workOpts, async (jobs: Job<PayloadFor<N>>[]) => {
    for (const job of jobs) {
      try {
        await handler(job.data);
      } catch (err) {
        log.error({ err, jobId: job.id, name }, "job handler failed");
        throw err;
      }
    }
  });
}
