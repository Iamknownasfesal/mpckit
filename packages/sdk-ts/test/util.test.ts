/**
 * Unit tests for the SDK's tiny `util.ts` — these helpers live below
 * the @ika.xyz/sdk import so they can also be bundled into the
 * Web Worker variant. Drift here breaks both the inline and worker
 * crypto engines, so we pin each contract.
 */
import { describe, expect, test } from "bun:test";

import {
  fromBase64,
  fromHex,
  newIdempotencyKey,
  pollUntil,
  randomSessionIdentifier,
  toHex,
} from "../src/util";

describe("toHex / fromHex", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x01, 0x80, 0x7f, 0xa5]);
    const hex = toHex(bytes);
    expect(hex).toBe("00ff01807fa5");
    expect(Array.from(fromHex(hex))).toEqual(Array.from(bytes));
  });

  test("toHex emits lowercase, two-digit-per-byte output", () => {
    const out = toHex(new Uint8Array([0, 1, 15, 16, 255]));
    expect(out).toBe("00010f10ff");
    expect(out.length).toBe(10);
  });

  test("fromHex accepts an optional 0x prefix", () => {
    const a = fromHex("0xdeadbeef");
    const b = fromHex("deadbeef");
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(4);
  });

  test("fromHex rejects odd-length input", () => {
    expect(() => fromHex("abc")).toThrow(/odd length/);
  });

  test("toHex of empty array is empty string", () => {
    expect(toHex(new Uint8Array(0))).toBe("");
    expect(fromHex("").length).toBe(0);
  });
});

describe("randomSessionIdentifier", () => {
  test("returns exactly 32 bytes", () => {
    expect(randomSessionIdentifier().length).toBe(32);
  });

  test("two calls produce different bytes", () => {
    const a = randomSessionIdentifier();
    const b = randomSessionIdentifier();
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("fromBase64", () => {
  test("decodes a standard base64 string", () => {
    // "Hello" → "SGVsbG8="
    const decoded = fromBase64("SGVsbG8=");
    expect(new TextDecoder().decode(decoded)).toBe("Hello");
  });

  test("decodes empty string to empty array", () => {
    expect(fromBase64("").length).toBe(0);
  });
});

describe("newIdempotencyKey", () => {
  test("returns a non-empty string", () => {
    const k = newIdempotencyKey();
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
  });

  test("two calls return different values", () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe("pollUntil", () => {
  test("returns the value the first time the predicate is true", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        return calls;
      },
      (n) => n >= 3,
      { intervalMs: 1, maxIntervalMs: 1, timeoutMs: 1_000 },
    );
    expect(result).toBe(3);
    expect(calls).toBe(3);
  });

  test("throws when the deadline passes without the predicate being true", async () => {
    const start = Date.now();
    await expect(
      pollUntil(
        async () => 0,
        (n) => n > 0,
        { intervalMs: 5, maxIntervalMs: 5, timeoutMs: 25 },
      ),
    ).rejects.toThrow(/timed out/);
    // The poll should give up within a small multiple of the timeout —
    // not the default 120s. Generous bound to avoid CI flakes.
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  test("returns immediately when the predicate is true on the first call", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        return "done";
      },
      () => true,
      { intervalMs: 1, timeoutMs: 100 },
    );
    expect(result).toBe("done");
    expect(calls).toBe(1);
  });
});
