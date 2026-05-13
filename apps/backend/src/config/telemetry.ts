/**
 * Telemetry bootstrap. Imported (for side effects) by `api.ts` and
 * `worker.ts` BEFORE any other backend module, so the OpenTelemetry
 * SDK and Sentry can wire their hooks into Node's module loader before
 * pg / ioredis / http are first required.
 *
 * Both stacks are env-gated:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT — start OTel SDK with HTTP/pg/ioredis
 *                                  auto-instrumentations
 *   SENTRY_DSN                  — initialise Sentry for error capture
 *
 * Unset means no-op; this is intentional so local dev stays
 * dependency-free.
 */
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as Sentry from "@sentry/bun";
import { env } from "@/config/env";

let otelSdk: NodeSDK | undefined;

function maybeStartOtel(): void {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  if (otelSdk) return;
  otelSdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // pino logs already capture HTTP request bodies via our own
        // request-logger plugin; the http instrumentation only needs
        // to emit the span structure.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });
  otelSdk.start();
}

function maybeStartSentry(): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Don't auto-enable PII capture — request bodies can carry the
    // user's `messageHex`, idempotency keys, deposit digests.
    sendDefaultPii: false,
  });
}

export function startTelemetry(): void {
  maybeStartOtel();
  maybeStartSentry();
}

export async function shutdownTelemetry(): Promise<void> {
  if (otelSdk) {
    await otelSdk.shutdown().catch(() => {
      // Best-effort; we're shutting down anyway.
    });
    otelSdk = undefined;
  }
  if (env.SENTRY_DSN) {
    await Sentry.flush(2000).catch(() => {});
  }
}

// Start immediately at module load so auto-instrumentations get a
// chance to monkey-patch http / pg / ioredis before any consumer
// requires them. Callers should `import "@/config/telemetry"` (no
// named import) at the very top of their entrypoint.
startTelemetry();

export { Sentry };
