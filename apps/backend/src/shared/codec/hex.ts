/**
 * Hex codec wrappers. Backend had four near-identical `fromHex`
 * functions across feature routes — same intent, slightly different
 * error shapes. Centralise on `@noble/hashes/utils` (already a dep)
 * so we don't keep redoing the parse loop, and so a request that
 * carries malformed hex always maps to the same `AppError`.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { errors } from "@/shared/errors";

export const toHex = bytesToHex;

/**
 * Decode a hex string (with or without `0x` prefix) into bytes. Throws
 * an `AppError(VALIDATION/BAD_HEX)` so the HTTP layer returns a clean
 * 400 with a stable code. `label` becomes part of the message so a
 * caller can tell which field was bad.
 */
export function fromHex(s: string, label?: string): Uint8Array {
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  try {
    return hexToBytes(stripped);
  } catch {
    const where = label ? ` for ${label}` : "";
    throw errors.validation(`expected hex${where}`, "BAD_HEX");
  }
}
