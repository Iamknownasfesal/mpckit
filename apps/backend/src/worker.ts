/**
 * Worker process entrypoint. Boots pg-boss, registers feature
 * handlers, schedules recurring jobs (presign refill tick + expired-
 * reservation sweep), and idles. No HTTP server.
 *
 * Multiple worker pods can run in parallel; pg-boss row-level locking
 * ensures each job is processed exactly once. Per-job parallelism is
 * configured at handler-registration time (`teamSize`).
 */
import { env } from "@/config/env";
import { log } from "@/config/log";
import { shutdownTelemetry } from "@/config/telemetry";
import { registerBillingJobs } from "@/features/billing/jobs";
import { registerPresignJobs } from "@/features/presigns/jobs";
import { bucketHealth, discover } from "@/features/presigns/service";
import { registerSignJobs } from "@/features/sign/jobs";
import { closeDb, isDbConfigured } from "@/shared/db/client";
import { runMigrations } from "@/shared/db/migrate";
import { listNetworks, warmupNetworks } from "@/shared/networks/registry";
import { closeBoss, enqueue, getBoss, schedule } from "@/shared/queue/client";
import { JOBS } from "@/shared/queue/types";
import { warmHotWallet } from "@/shared/sui/hot-wallet";

// Presign buckets we keep ready. Each tuple is (curve, signatureAlgorithm).
// secp256k1+ECDSA (Ethereum), secp256k1+Taproot (Bitcoin), ed25519+EdDSA (Solana).
const SUPPORTED_BUCKETS: Array<{ curve: number; signatureAlgorithm: number }> =
  [
    { curve: 0, signatureAlgorithm: 0 },
    { curve: 0, signatureAlgorithm: 1 },
    { curve: 2, signatureAlgorithm: 0 },
  ];

/**
 * On boot, enqueue a refill for any (network, bucket) whose
 * ready+pending count is below `PRESIGN_POOL_LOW_WATER`. Idempotent: a
 * warm pool boots into a no-op. Runs across every enabled network so
 * a single worker pod can keep both testnet and mainnet pools full.
 */
async function warmupPresignPool(): Promise<void> {
  const lowWater = env.PRESIGN_POOL_LOW_WATER;
  for (const network of listNetworks()) {
    for (const bucket of SUPPORTED_BUCKETS) {
      const health = await bucketHealth(
        network,
        bucket.curve,
        bucket.signatureAlgorithm,
      );
      const inFlight = health.ready + health.pending;
      if (inFlight >= lowWater) continue;
      const want = Math.min(lowWater - inFlight, env.PRESIGN_BATCH_SIZE);
      await enqueue(JOBS.presignRefill, {
        network,
        curve: bucket.curve,
        signatureAlgorithm: bucket.signatureAlgorithm,
        count: want,
      });
      log.info(
        {
          network,
          curve: bucket.curve,
          sigAlgo: bucket.signatureAlgorithm,
          ready: health.ready,
          pending: health.pending,
          enqueued: want,
        },
        "presign warmup: refill enqueued",
      );
    }
  }
}

const SHUTDOWN_TIMEOUT_MS = 30_000;

export async function startWorker(): Promise<void> {
  if (!isDbConfigured()) {
    throw new Error("worker: DATABASE_URL is required");
  }
  await runMigrations();

  const networks = listNetworks();
  log.info({ networks }, "worker: warming hot wallet + ika clients");
  await warmHotWallet();
  await warmupNetworks();

  await getBoss();

  // Feature handlers attach themselves to pg-boss; the registration
  // calls are idempotent so re-runs (multi-pod boot) are safe.
  await registerPresignJobs();
  await registerSignJobs();
  await registerBillingJobs();

  // Boot warmup: pre-fill presign buckets so the first sign on a fresh
  // deploy doesn't trip PRESIGN_POOL_EMPTY before the lazy refill fires.
  await warmupPresignPool();

  // Boot reconcile: caps minted by older mpckitcore deployments or
  // out-of-band operator scripts won't appear in the DB until
  // discover() runs. Surface that drift immediately on boot so
  // operators don't have to wait for the 15-min cron to catch up.
  for (const network of networks) {
    try {
      const result = await discover(network);
      if (result.inserted > 0 || result.failed > 0) {
        log.info(
          { network, ...result },
          "presign warmup: discover reconciled drift",
        );
      }
    } catch (err) {
      log.warn({ err, network }, "presign warmup: discover failed");
    }
  }

  // Recurring jobs.
  await schedule(JOBS.presignSweepExpired, "*/1 * * * *", {
    olderThanSec: env.PRESIGN_RESERVATION_TTL_SEC,
  });
  await schedule(JOBS.signSweepPrepared, "*/2 * * * *", {
    olderThanSec: env.PRESIGN_RESERVATION_TTL_SEC,
  });
  await schedule(JOBS.billingSweepRetry, "*/10 * * * *", {
    olderThanSec: 600,
  });

  // Steady-state reconciliation: scan operator-owned caps every 15
  // minutes per enabled network so any drift since boot (manual mints,
  // race losses between refill insert and PTB commit) heals itself.
  for (const network of networks) {
    await schedule(JOBS.presignDiscover, "*/15 * * * *", { network });
  }

  log.info("mpckit worker ready");

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "graceful shutdown: draining worker");

    const hardExit = setTimeout(() => {
      log.warn({ signal }, "graceful shutdown: timeout, hard-exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardExit.unref();

    try {
      await closeBoss();
      await closeDb();
      await shutdownTelemetry();
      log.info("graceful shutdown: complete");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "graceful shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
