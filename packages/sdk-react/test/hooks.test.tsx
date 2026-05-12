/**
 * React hook tests. Covers:
 *
 *   - `useMPCKit` throws when no Provider is mounted.
 *   - `useBalance` reads through to `MPCKit.balance()` and surfaces
 *     `{data, isLoading}` in the documented shape.
 *   - `useDeclareDeposit` mutation triggers `MPCKit.declareDeposit()`
 *     and invalidates balance + history (the most observable cache
 *     invalidation, exercising the same wiring used by `useOnboard`
 *     and `useSign`).
 *
 * Bun runs each `*.test.tsx` in its own VM, but module mocks are
 * process-global. We don't mock `@ika.xyz/sdk` here because the
 * hooks never reach the crypto engine — only the HTTP layer.
 */
import { describe, expect, test } from "bun:test";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useBalance } from "../src/hooks/use-balance";
import { useDeclareDeposit } from "../src/hooks/use-declare-deposit";
import { useMPCKit } from "../src/provider";
import { mpcKitQueryKeys } from "../src/query-keys";
import { fakeFetch, makeQueryClient, Providers } from "./util";

function wrapper(
  qc: ReturnType<typeof makeQueryClient>,
  fetchImpl: typeof fetch,
) {
  return ({ children }: { children: ReactNode }) => (
    <Providers qc={qc} fetchImpl={fetchImpl}>
      {children}
    </Providers>
  );
}

describe("useMPCKit", () => {
  test("throws when called outside Provider", () => {
    expect(() => renderHook(() => useMPCKit())).toThrow(
      /must be used inside <MPCKitProvider>/,
    );
  });
});

describe("useBalance", () => {
  test("returns the live balance + transitions out of isLoading", async () => {
    const qc = makeQueryClient();
    const fetchImpl = fakeFetch({
      "/v1/billing/balance": { creditsMicro: "12345" },
    });
    const { result } = renderHook(() => useBalance(), {
      wrapper: wrapper(qc, fetchImpl),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.creditsMicro).toBe("12345");
  });
});

describe("useDeclareDeposit", () => {
  test("calls the API and invalidates balance + history on success", async () => {
    const qc = makeQueryClient();
    // Spy on invalidateQueries so we can assert the mutation hook
    // busts the right caches without depending on cache-state snapshot
    // semantics that have shifted across query-core versions.
    const invalidations: { queryKey: readonly unknown[] }[] = [];
    const orig = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = (filters?: { queryKey?: readonly unknown[] }) => {
      if (filters?.queryKey) invalidations.push({ queryKey: filters.queryKey });
      return orig(filters);
    };

    const fetchImpl = fakeFetch({
      "/v1/billing/deposit": {
        deposit: {
          id: "d-1",
          txDigest: "DIGEST",
          senderAddress: "0xS",
          coinType: "0x2::sui::SUI",
          amountAtomic: "2000000000",
          creditsCredited: "2000000000",
          sweepStatus: "pending",
          sweepTxDigest: null,
          createdAt: "2026-05-08T00:00:00Z",
          sweptAt: null,
        },
        duplicate: false,
        creditsMicro: "2000000000",
      },
    });

    const { result } = renderHook(() => useDeclareDeposit(), {
      wrapper: wrapper(qc, fetchImpl),
    });

    let data:
      | Awaited<ReturnType<typeof result.current.mutateAsync>>
      | undefined;
    await act(async () => {
      data = await result.current.mutateAsync("DIGEST");
    });

    expect(data?.duplicate).toBe(false);
    expect(data?.deposit.txDigest).toBe("DIGEST");

    const keys = invalidations.map((i) => JSON.stringify(i.queryKey));
    expect(keys).toContain(JSON.stringify(mpcKitQueryKeys.balance()));
    expect(keys).toContain(JSON.stringify(mpcKitQueryKeys.billingHistory()));
  });
});

describe("Provider smoke", () => {
  test("renders children and exposes the api via context", () => {
    const qc = makeQueryClient();
    const fetchImpl = fakeFetch({});
    const { container } = render(
      <Providers qc={qc} fetchImpl={fetchImpl}>
        <span data-testid="child">ok</span>
      </Providers>,
    );
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe(
      "ok",
    );
  });
});
