"use client";

import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import "@mysten/dapp-kit/dist/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

const networks = {
  testnet: {
    network: "testnet" as const,
    url: getJsonRpcFullnodeUrl("testnet"),
  },
  mainnet: {
    network: "mainnet" as const,
    url: getJsonRpcFullnodeUrl("mainnet"),
  },
};

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Most dashboard reads are eventually-consistent (balance,
            // history). Hold a value for 10s before considering it
            // stale, then re-fetch on focus.
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
