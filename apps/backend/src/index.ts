/**
 * Single binary, two roles. `PROCESS_TYPE` selects which boots:
 *
 *   - `api`    : HTTP server only (default).
 *   - `worker` : pg-boss handlers only (presign refill, sign worker).
 *   - `both`   : both in one process (dev / single-pod deployments).
 *
 * In production, run the API and worker as separate Deployments in
 * Kubernetes so they scale independently.
 */
// Side-effect import: starts OpenTelemetry + Sentry before any other
// module (pg, ioredis, http, fetch) is loaded so auto-instrumentations
// get a chance to monkey-patch Node's loaders. No-op when both
// OTEL_EXPORTER_OTLP_ENDPOINT and SENTRY_DSN are unset.
import "@/config/telemetry";
import { startApi } from "@/api";
import { env } from "@/config/env";
import { log } from "@/config/log";
import { listNetworks } from "@/shared/networks/registry";
import { startWorker } from "@/worker";

const role = env.PROCESS_TYPE;

async function main() {
  log.info({ role, networks: listNetworks() }, "mpckit starting");
  if (role === "api" || role === "both") {
    await startApi();
  }
  if (role === "worker" || role === "both") {
    await startWorker();
  }
}

main().catch((err) => {
  log.fatal({ err }, "boot failed");
  process.exit(1);
});
