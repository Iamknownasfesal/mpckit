/**
 * Tests for `callResilient` — the p-retry + opossum wrapper around Sui
 * gRPC calls. Pin:
 *   - terminal gRPC codes bypass retry (fail fast)
 *   - transient errors get re-tried up to `retries` times
 *   - happy path returns the inner value
 *   - the breaker test-reset helper actually resets state
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@/config/log", () => ({
  log: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

const { _resetBreakersForTest, callResilient } = await import(
  "@/shared/sui/resilience"
);

describe("callResilient happy path", () => {
  beforeEach(() => _resetBreakersForTest());
  afterEach(() => _resetBreakersForTest());

  test("returns the inner value when fn succeeds the first time", async () => {
    let calls = 0;
    const result = await callResilient(
      async () => {
        calls++;
        return "ok";
      },
      { name: "test:happy-path" },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries transient failures and eventually succeeds", async () => {
    let attempts = 0;
    const result = await callResilient(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("transient blip");
        }
        return 42;
      },
      { name: "test:transient", retries: 5 },
    );
    expect(result).toBe(42);
    expect(attempts).toBe(3);
  });
});

describe("callResilient terminal failures bypass retry", () => {
  beforeEach(() => _resetBreakersForTest());
  afterEach(() => _resetBreakersForTest());

  test("INVALID_ARGUMENT fails fast (single attempt)", async () => {
    let attempts = 0;
    await expect(
      callResilient(
        async () => {
          attempts++;
          const err = new Error("bad arg") as Error & { code: string };
          err.code = "INVALID_ARGUMENT";
          throw err;
        },
        { name: "test:invalid-arg", retries: 5 },
      ),
    ).rejects.toThrow(/bad arg/);
    expect(attempts).toBe(1);
  });

  test("numeric gRPC status 9 (FAILED_PRECONDITION) fails fast", async () => {
    let attempts = 0;
    await expect(
      callResilient(
        async () => {
          attempts++;
          const err = new Error("precondition") as Error & { code: number };
          err.code = 9;
          throw err;
        },
        { name: "test:fp-numeric", retries: 5 },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  test("NOT_FOUND fails fast", async () => {
    let attempts = 0;
    await expect(
      callResilient(
        async () => {
          attempts++;
          const err = new Error("missing") as Error & { code: string };
          err.code = "NOT_FOUND";
          throw err;
        },
        { name: "test:not-found", retries: 3 },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  test("retries exhaust for non-terminal errors then throws", async () => {
    let attempts = 0;
    await expect(
      callResilient(
        async () => {
          attempts++;
          throw new Error("network blip");
        },
        { name: "test:exhaust", retries: 2 },
      ),
    ).rejects.toThrow(/network blip/);
    // retries=2 means 3 total attempts (1 + 2 retries).
    expect(attempts).toBe(3);
  });
});

describe("_resetBreakersForTest", () => {
  test("clears the per-name breaker map", async () => {
    // Fire one call so the breaker map is non-empty.
    await callResilient(async () => "x", { name: "test:reset" });
    _resetBreakersForTest();
    // Subsequent call must still succeed (fresh breaker).
    expect(await callResilient(async () => "y", { name: "test:reset" })).toBe(
      "y",
    );
  });
});
