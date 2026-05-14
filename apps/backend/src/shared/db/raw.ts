/**
 * Helpers for working with Drizzle's raw-SQL execute path.
 *
 * Drizzle's `getDb().execute(sql\`...\`)` returns different shapes
 * depending on the underlying driver: postgres-js returns a plain
 * array, node-postgres wraps it in `{rows: T[]}`. Existing code in
 * a few hot paths (presigns claim, bucket-health histogram) handled
 * both shapes inline, which read poorly and bit-rotted any time a
 * new raw query was added. Centralise the unwrap here.
 */

/**
 * Extract row array from a Drizzle raw-SQL result regardless of
 * whether the underlying driver wraps it in `{rows}` or returns the
 * array directly.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result !== null &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
