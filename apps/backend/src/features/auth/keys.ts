/**
 * API key utilities.
 *
 * Format: `mpckit_<env>_<32 url-safe chars>`. The prefix tells operators
 * at a glance which deployment a key belongs to (test vs live), the
 * suffix is 192 bits of entropy from `crypto.getRandomValues`.
 *
 * Plaintext keys are shown to the user **once**, at creation time.
 * We persist sha256(plaintext) hex in the database; lookups happen by
 * hash.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PLAINTEXT_BYTES = 24; // 24 bytes => 32 base64url chars
const PREFIX_LEN = 16; // "mpckit_test_AbCd" prefix saved for display

export type ApiKeyNetwork = "testnet" | "mainnet";

export interface IssuedKey {
  /** Full plaintext: returned to the user exactly once. */
  plaintext: string;
  /** First N characters of the plaintext, kept in DB for display. */
  prefix: string;
  /** sha256 hex of the plaintext, stored in DB. */
  hash: string;
}

function tagFor(network: ApiKeyNetwork): "test" | "live" {
  return network === "mainnet" ? "live" : "test";
}

/**
 * Network-tagged from the plaintext itself: a mainnet key reads
 * `mpckit_live_…`, a testnet key reads `mpckit_test_…`. The tag is
 * load-bearing — auth middleware uses the row's `network` column to
 * pick the effective network, never a client-supplied header.
 */
export function generateApiKey(network: ApiKeyNetwork): IssuedKey {
  const buf = randomBytes(PLAINTEXT_BYTES);
  const body = buf.toString("base64url");
  const plaintext = `mpckit_${tagFor(network)}_${body}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX_LEN),
    hash: hashKey(plaintext),
  };
}

/**
 * Sniff the network from a plaintext token. Used by middleware as a
 * cheap sanity check; the persisted row is still the source of truth.
 */
export function networkFromPlaintext(plaintext: string): ApiKeyNetwork | null {
  if (plaintext.startsWith("mpckit_live_")) return "mainnet";
  if (plaintext.startsWith("mpckit_test_")) return "testnet";
  return null;
}

/** sha256 hex of a key plaintext. */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Parse `Authorization: Bearer ...` header. Returns plaintext or null. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const token = m[1] ?? "";
  // Reject obviously bogus inputs early (don't even hash them).
  if (token.length < 16 || token.length > 200) return null;
  return token;
}

/**
 * Constant-time equality for hashes. Both sides are hex digests of the
 * same length, so this is mostly belt-and-suspenders for paths where
 * we ever compare two hashes directly (e.g. test seeding).
 */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
