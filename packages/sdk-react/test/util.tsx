/**
 * Shared test fixtures for the React SDK. Wraps `MpcKitProvider` in a
 * fresh `QueryClient` per test so cache state doesn't leak between
 * cases. Hooks under test get a synchronous-friendly Query setup
 * (retry off, no caching) for predictable assertions.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MpcKitProvider } from "../src/provider";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function Providers({
  qc,
  fetchImpl,
  children,
}: {
  qc: QueryClient;
  fetchImpl: typeof fetch;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={qc}>
      <MpcKitProvider
        options={{
          baseUrl: "http://localhost:0",
          apiKey: "test",
          network: "testnet",
          fetch: fetchImpl,
        }}
      >
        {children}
      </MpcKitProvider>
    </QueryClientProvider>
  );
}

export function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const path = new URL(url).pathname;
    const body = routes[path];
    if (!body) {
      return new Response(JSON.stringify({ error: `no stub for ${path}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}
