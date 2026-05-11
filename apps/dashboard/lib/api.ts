/**
 * Thin typed fetch wrapper around the backend HTTP surface.
 *
 * The dashboard always sends `credentials: "include"` so Better-Auth's
 * session cookie rides along; the backend's authMiddleware resolves it
 * into a Principal automatically. No bearer token in the browser.
 *
 * Non-2xx responses throw `ApiError` carrying the wire `code` so
 * callers can branch on `INSUFFICIENT_CREDITS` / `NOT_FOUND` / etc.
 */
import { BACKEND_URL } from "./env";
import { currentNetwork } from "./network";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-network": currentNetwork(),
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = text;
  if (text && res.headers.get("content-type")?.includes("application/json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // surfaces below as a non-JSON body
    }
  }
  if (!res.ok) {
    const code = (parsed as { code?: string }).code ?? "UNKNOWN_ERROR";
    const message =
      (parsed as { error?: string }).error ??
      `${method} ${path} failed with ${res.status}`;
    throw new ApiError(message, res.status, code, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
