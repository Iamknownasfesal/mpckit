/**
 * Internal typed fetch wrapper. Public consumers reach this only via
 * `MpcKit.raw` (escape hatch) — most callers use the high-level API.
 */
import {
  MpcKitError,
  MpcKitInsufficientCreditsError,
  MpcKitTimeoutError,
} from "./errors";

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  get<T>(path: string): Promise<T> {
    return this.request("GET", path);
  }

  post<T>(
    path: string,
    body?: unknown,
    opts: { idempotencyKey?: string; body?: unknown } = {},
  ): Promise<T> {
    // `body` parameter takes precedence; the `opts.body` is kept so callers
    // that prefer to pass headers + body together can skip a positional.
    return this.request("POST", path, {
      body: opts.body !== undefined ? opts.body : body,
      idempotencyKey: opts.idempotencyKey,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request("DELETE", path);
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        throw new MpcKitTimeoutError(`${method} ${path} timed out`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let body: unknown = text;
    if (text && res.headers.get("content-type")?.includes("application/json")) {
      try {
        body = JSON.parse(text);
      } catch {
        // fall through; surfaces as non-JSON body in the error
      }
    }
    if (!res.ok) {
      const code = (body as { code?: string }).code ?? "UNKNOWN_ERROR";
      const message =
        (body as { error?: string }).error ??
        `${method} ${path} failed with ${res.status}`;
      if (res.status === 402) throw new MpcKitInsufficientCreditsError(body);
      throw new MpcKitError(message, res.status, code, body);
    }
    return body as T;
  }
}
