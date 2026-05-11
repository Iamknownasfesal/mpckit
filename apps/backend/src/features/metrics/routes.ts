import { refreshAgeGauge } from "@/features/pricing/price-feed";
import { registry } from "@/shared/cache/metrics";
import { Elysia } from "elysia";

/**
 * Prometheus scrape endpoint. No auth: a /metrics endpoint that
 * leaks anything sensitive is a bug elsewhere. If you want to gate
 * it from public, do that at the proxy / network layer.
 *
 * On scrape we recompute "live" gauges (price feed age, etc.) so the
 * exported value reflects the moment of the scrape rather than the
 * last refresh tick.
 */
export const metricsRoutes = new Elysia().get(
  "/metrics",
  async ({ set }) => {
    refreshAgeGauge();
    set.headers["content-type"] = registry.contentType;
    return await registry.metrics();
  },
  {
    detail: {
      tags: ["meta"],
      summary: "Prometheus scrape",
      description:
        "Prometheus exposition-format metrics for HTTP requests, queue jobs, price feed health, sweep state, and balance gauges. Live gauges (price-feed age, etc.) are recomputed at scrape time. No auth — gate at the proxy / network layer if needed.",
    },
  },
);
