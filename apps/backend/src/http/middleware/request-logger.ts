import { type Logger, log } from "@/config/log";
import { httpLatency } from "@/shared/cache/metrics";
/**
 * Request lifecycle logger.
 *
 * - Reads `x-request-id` from the inbound request, or mints one with
 *   `crypto.randomUUID()` so every request is correlatable end-to-end.
 * - Echoes the id back via the same header on the response.
 * - Attaches a child pino logger (with `requestId` baked in) onto the
 *   Elysia context as `ctx.log`, so handlers and downstream services can
 *   emit lines that join up by id.
 * - Emits exactly one structured access-log line per response with
 *   method, path, status, latency.
 * - Records the same latency in the `mpckit_http_request_duration_seconds`
 *   Prometheus histogram, labeled by route + status.
 */
import { Elysia } from "elysia";

const REQUEST_ID_HEADER = "x-request-id";

interface RequestState {
  startNs: bigint;
  childLog: Logger;
  requestId: string;
}

/**
 * Per-request state lives in a WeakMap keyed on the inbound `Request`.
 * Elysia's hook pipeline (`derive`, `onAfterResponse`) doesn't reliably
 * share derived values across all phases, but every hook does see the
 * same `Request` object — so we attach state to that.
 */
const state = new WeakMap<Request, RequestState>();

function routeOf(ctx: { route?: string; path?: string }): string {
  return ctx.route ?? ctx.path ?? "unknown";
}

/** Look up the per-request child logger by `Request`. Falls back to root. */
export function loggerFor(request: Request): Logger {
  return state.get(request)?.childLog ?? log;
}

/** Look up the request id (or undefined if not yet attached). */
export function requestIdFor(request: Request): string | undefined {
  return state.get(request)?.requestId;
}

export const requestLogger = new Elysia({ name: "request-logger" })
  .onRequest(({ request, set }) => {
    const incoming = request.headers.get(REQUEST_ID_HEADER);
    const requestId =
      incoming && incoming.length > 0 && incoming.length <= 200
        ? incoming
        : crypto.randomUUID();
    set.headers[REQUEST_ID_HEADER] = requestId;
    state.set(request, {
      requestId,
      childLog: log.child({ requestId }),
      startNs: process.hrtime.bigint(),
    });
  })
  .onAfterResponse(({ request, set, path }) => {
    const s = state.get(request);
    if (!s) return;
    const elapsed = Number(process.hrtime.bigint() - s.startNs) / 1e9;
    const status = typeof set.status === "number" ? set.status : 200;
    const route = routeOf({ path });

    httpLatency.observe(
      { method: request.method, route, status: String(status) },
      elapsed,
    );

    s.childLog.info(
      {
        method: request.method,
        route,
        path,
        status,
        durationMs: Math.round(elapsed * 1000),
      },
      "request",
    );
    state.delete(request);
  });
