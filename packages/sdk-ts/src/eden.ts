/**
 * Type-safe HTTP client over `@elysiajs/eden`. Consumers get the
 * backend's exact route signatures (status codes, query params, body
 * shapes, response types) with zero codegen — `treaty<App>` reads the
 * App's TypeScript type at compile time.
 *
 * Use this when you want raw HTTP with end-to-end type safety. The
 * ceremony orchestrators (`onboard`, `sign`) still live on `MpcKit`
 * because they coordinate WASM crypto with multiple HTTP calls; treaty
 * only handles the wire boundary.
 *
 * Example:
 *
 *   import { createEdenClient } from "@mpckit/sdk/eden";
 *
 *   const client = createEdenClient({
 *     baseUrl: "http://localhost:3000",
 *     apiKey: "mpckit_test_…",
 *   });
 *
 *   const { data, error } = await client.v1.billing.balance.get();
 *   //          ^? { creditsMicro: string; creditsUsd: string }
 *
 * Note: `@mpckit/backend` is a *type-only* dep on this package; the
 * runtime never crosses the package boundary. Bundlers + tsc both
 * tree-shake the import to nothing.
 */
import { treaty } from "@elysiajs/eden";
// Type-only import via relative path: turbo would flag a `@mpckit/backend`
// package.json dep as a build cycle (backend depends on @mpckit/sdk
// at runtime), and the App type lives only in the source tree, never
// in a built artifact, so a relative path is the honest description.
import type { App } from "../../../apps/backend/src/http/elysia";

export interface EdenClientOptions {
  /** Origin of the backend (no trailing slash). */
  baseUrl: string;
  /** API key sent as `Authorization: Bearer <key>`. */
  apiKey?: string;
  /**
   * Custom fetch function. Eden calls this verbatim for every request,
   * so the same shape works for tests (mocked transports), bun's
   * global fetch, and runtimes that polyfill fetch. The treaty config
   * field is named `fetcher`; we expose it as `fetch` to match the
   * conventional name on `MpcKit` and the rest of this SDK.
   */
  fetch?: typeof fetch;
}

export type EdenClient = ReturnType<typeof createEdenClient>;

/**
 * Extract the success-payload type from a treaty method's promised
 * result. Treaty returns `{ data, error }`; this picks `data` and
 * strips its `null`-on-error branch so consumers don't have to.
 *
 * Example:
 *   type Balance = EdenData<ReturnType<EdenClient["v1"]["billing"]["balance"]["get"]>>;
 */
export type EdenData<T> =
  Awaited<T> extends { data: infer D } ? NonNullable<D> : never;

export function createEdenClient(opts: EdenClientOptions) {
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  return treaty<App>(opts.baseUrl, {
    headers,
    ...(opts.fetch ? { fetcher: opts.fetch } : {}),
  });
}
