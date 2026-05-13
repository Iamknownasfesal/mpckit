/**
 * Tests for the internal `HttpClient`. Covers the full request matrix
 * (GET / POST / DELETE), header construction, the timeout path, JSON
 * body parsing, the 402 → MPCKitInsufficientCreditsError mapping, and
 * the general `code` extraction from error bodies.
 */
import { describe, expect, test } from "bun:test";

import {
  MPCKitError,
  MPCKitInsufficientCreditsError,
  MPCKitTimeoutError,
} from "../src/errors";
import { HttpClient } from "../src/http";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeFetchSpy(handler: (path: string) => Response) {
  const calls: CapturedCall[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });
    const path = new URL(url).pathname;
    return handler(path);
  }) as typeof fetch;
  return { f, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseOpts = {
  baseUrl: "http://localhost:4000",
  apiKey: "mpckit_test_abc",
};

describe("HttpClient constructor", () => {
  test("strips trailing slash from baseUrl", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ ok: true }));
    const c = new HttpClient({
      ...baseOpts,
      baseUrl: "http://x/",
      fetch: spy.f,
    });
    await c.get("/v1/ping");
    expect(spy.calls[0]!.url).toBe("http://x/v1/ping");
  });
});

describe("HttpClient.get", () => {
  test("attaches Bearer token + Accept JSON, no content-type for GET", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ ok: true }));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    const result = await c.get<{ ok: boolean }>("/v1/network");
    expect(result.ok).toBe(true);
    const headers = spy.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer mpckit_test_abc");
    expect(headers.accept).toBe("application/json");
    expect(headers["content-type"]).toBeUndefined();
    expect(spy.calls[0]!.init.method).toBe("GET");
    expect(spy.calls[0]!.init.body).toBeUndefined();
  });

  test("returns the raw text when content-type is not JSON", async () => {
    const spy = makeFetchSpy(
      () =>
        new Response("plain text body", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    const result = await c.get<string>("/v1/raw");
    expect(result).toBe("plain text body");
  });

  test("falls back to text when JSON header is set but body isn't valid JSON", async () => {
    const spy = makeFetchSpy(
      () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    const result = await c.get<unknown>("/v1/bad");
    expect(result).toBe("not json");
  });
});

describe("HttpClient.post", () => {
  test("sets content-type when body is present + serializes JSON", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ ok: true }));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    await c.post("/v1/onboard", { curve: "ED25519" });
    const headers = spy.calls[0]!.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(spy.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(spy.calls[0]!.init.body as string)).toEqual({
      curve: "ED25519",
    });
  });

  test("forwards idempotencyKey via the idempotency-key header", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ ok: true }));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    await c.post("/v1/sign", { msg: "x" }, { idempotencyKey: "abc-123" });
    const headers = spy.calls[0]!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("abc-123");
  });

  test("opts.body wins over the positional body argument", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ ok: true }));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    await c.post("/v1/x", { wrong: true }, { body: { right: true } });
    expect(JSON.parse(spy.calls[0]!.init.body as string)).toEqual({
      right: true,
    });
  });
});

describe("HttpClient.delete", () => {
  test("sends DELETE with auth + no body", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ deleted: true }));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    await c.delete("/v1/keys/abc");
    expect(spy.calls[0]!.init.method).toBe("DELETE");
    expect(spy.calls[0]!.init.body).toBeUndefined();
    const headers = spy.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer mpckit_test_abc");
  });
});

describe("HttpClient error paths", () => {
  test("402 maps to MPCKitInsufficientCreditsError", async () => {
    const spy = makeFetchSpy(() =>
      jsonResponse({ code: "INSUFFICIENT_CREDITS", error: "top up" }, 402),
    );
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    await expect(c.get("/v1/billing")).rejects.toBeInstanceOf(
      MPCKitInsufficientCreditsError,
    );
  });

  test("non-402 errors throw MPCKitError carrying status + code + body", async () => {
    const body = { code: "NOT_FOUND", error: "dwallet not found", id: "abc" };
    const spy = makeFetchSpy(() => jsonResponse(body, 404));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    try {
      await c.get("/v1/dwallets/abc");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(MPCKitError);
      const me = e as MPCKitError;
      expect(me.status).toBe(404);
      expect(me.code).toBe("NOT_FOUND");
      expect(me.body).toEqual(body);
      expect(me.message).toBe("dwallet not found");
    }
  });

  test("error body without code falls back to UNKNOWN_ERROR", async () => {
    const spy = makeFetchSpy(() => jsonResponse({ error: "oops" }, 500));
    const c = new HttpClient({ ...baseOpts, fetch: spy.f });
    try {
      await c.get("/v1/x");
      throw new Error("expected throw");
    } catch (e) {
      const me = e as MPCKitError;
      expect(me.code).toBe("UNKNOWN_ERROR");
      expect(me.status).toBe(500);
    }
  });

  test("aborted fetch becomes MPCKitTimeoutError", async () => {
    // Fetch that never resolves but honors signal abort.
    const stalledFetch = ((_: unknown, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as typeof fetch;
    const c = new HttpClient({
      ...baseOpts,
      fetch: stalledFetch,
      timeoutMs: 20,
    });
    await expect(c.get("/v1/slow")).rejects.toBeInstanceOf(MPCKitTimeoutError);
  });
});
