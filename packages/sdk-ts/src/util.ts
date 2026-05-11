/**
 * Tiny shared helpers. No external dependencies so this can move into
 * a Web Worker bundle without dragging in @ika.xyz/sdk.
 */

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

export function fromHex(s: string): Uint8Array {
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (stripped.length % 2 !== 0) {
    throw new Error("hex string has odd length");
  }
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 32 random bytes for use as a session identifier. */
export function randomSessionIdentifier(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Browser- and node-safe base64 decode. Avoids `Buffer` so the SDK
 * works in the React/web bundle without a polyfill.
 */
export function fromBase64(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Stable idempotency key for retried prepares; uses crypto.randomUUID when present. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return toHex(b);
}

export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (v: T) => boolean,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    backoff?: number;
    maxIntervalMs?: number;
  } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let interval = opts.intervalMs ?? 1_000;
  const backoff = opts.backoff ?? 1.4;
  const maxInterval = opts.maxIntervalMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = await fetchOnce();
    if (isDone(value)) return value;
    if (Date.now() > deadline) {
      throw new Error("pollUntil: timed out");
    }
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(maxInterval, Math.floor(interval * backoff));
  }
}
