/**
 * API process entrypoint. Boots the HTTP server only.
 *
 *   1. Validate env (zod, in `@/config/env`).
 *   2. If `DATABASE_URL` is set: run drizzle migrations + admin bootstrap.
 *   3. Warm hot wallet + IkaClient(s) for every enabled network + WASM
 *      protocol-parameter caches so the first user request never pays
 *      init cost.
 *   4. Build + listen via Bun's native server.
 *   5. SIGTERM/SIGINT drains via `app.stop()`, then closes DB + Redis.
 *
 * Workers run in a separate process (`src/worker.ts`); see `index.ts`
 * for the dispatcher.
 */
import { defaultNetwork, env } from "@/config/env";
import { log } from "@/config/log";
import { shutdownTelemetry } from "@/config/telemetry";
import { bootstrapAdmin } from "@/features/auth/bootstrap";
import { stopPriceFeed, warmPriceFeed } from "@/features/pricing/price-feed";
import { warmupProtocolParameters } from "@/features/protocol-parameters/service";
import { buildApp } from "@/http/elysia";
import { closeRedis } from "@/http/middleware/rate-limit";
import { closeDb, isDbConfigured } from "@/shared/db/client";
import { runMigrations } from "@/shared/db/migrate";
import { getIkaConfig } from "@/shared/ika/client";
import { listNetworks, warmupNetworks } from "@/shared/networks/registry";
import {
  startBalancePoller,
  stopBalancePoller,
} from "@/shared/sui/balance-poller";
import { warmHotWallet } from "@/shared/sui/hot-wallet";

const SUPPORTED_CURVES = [0, 1, 2, 3];
const SHUTDOWN_TIMEOUT_MS = 10_000;

export async function startApi(): Promise<void> {
  if (isDbConfigured()) {
    await runMigrations();
    await bootstrapAdmin();
  } else {
    log.warn(
      "DATABASE_URL not set: running in DB-less mode (public read endpoints only)",
    );
  }

  const networks = listNetworks();
  log.info({ networks }, "warming ika clients + caches");
  // Hot wallet first: KMS provider does an async decrypt, and every
  // other warmup downstream reads the wallet's address.
  await warmHotWallet();
  await warmupNetworks();
  const result = await warmupProtocolParameters(SUPPORTED_CURVES);
  log.info(
    { warmed: result.warmed, skipped: result.skipped },
    "wasm warmup complete",
  );

  // Resolve the IKA coin type from the default network's deployed
  // package id and warm the USD price feed. Both networks use the same
  // IKA coin type because the package address matches across networks
  // for the published mpckit deployment; if that ever stops being true
  // we'd need a per-network coin map here.
  const cfg = getIkaConfig(defaultNetwork());
  const ikaCoinType = `${cfg.packages.ikaPackage}::ika::IKA`;
  await warmPriceFeed({ ikaCoinType });
  log.info({ ikaCoinType }, "price feed warmed");

  startBalancePoller();

  const app = buildApp();
  app.listen(env.PORT, ({ hostname, port }) => {
    log.info({ hostname, port, networks }, "mpckit http listening");
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "graceful shutdown: draining http");

    const hardExit = setTimeout(() => {
      log.warn({ signal }, "graceful shutdown: timeout, hard-exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    hardExit.unref();

    try {
      stopPriceFeed();
      stopBalancePoller();
      await app.stop();
      await Promise.allSettled([closeDb(), closeRedis(), shutdownTelemetry()]);
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
