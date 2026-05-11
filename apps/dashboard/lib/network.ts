/**
 * Runtime network switcher. Both networks are served by the same backend;
 * the dashboard picks one and sends it as `x-network` on every API call.
 * Preference is cached in `localStorage` so reloads remember the choice.
 *
 * - `currentNetwork()` is module-level so non-React code (`lib/api.ts`)
 *   can read it without a hook. It hydrates from localStorage on first
 *   access in the browser.
 * - `useNetwork()` is the React surface. It subscribes to the same
 *   underlying store so the switcher updates every consumer.
 * - `setNetwork()` writes the new value, notifies subscribers, and is
 *   the only thing that triggers re-renders.
 */
"use client";

import { useSyncExternalStore } from "react";

export type Network = "testnet" | "mainnet";

const STORAGE_KEY = "mpckit.network";

function defaultNetwork(): Network {
  return process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "mainnet"
    ? "mainnet"
    : "testnet";
}

let current: Network | null = null;
const listeners = new Set<() => void>();

function readStored(): Network {
  if (typeof window === "undefined") return defaultNetwork();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "testnet" || raw === "mainnet") return raw;
  return defaultNetwork();
}

export function currentNetwork(): Network {
  if (current === null) current = readStored();
  return current;
}

export function setNetwork(next: Network): void {
  if (next === current) return;
  current = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useNetwork(): Network {
  return useSyncExternalStore(subscribe, currentNetwork, defaultNetwork);
}

const NETWORK_LABELS: Record<Network, string> = {
  testnet: "Sui testnet",
  mainnet: "Sui mainnet",
};

const NETWORK_HINTS: Record<Network, string> = {
  testnet: "Faucet-funded · safe to break",
  mainnet: "Production · real value",
};

export function networkLabel(network: Network): string {
  return NETWORK_LABELS[network];
}

export function networkHint(network: Network): string {
  return NETWORK_HINTS[network];
}

export function otherNetwork(network: Network): Network {
  return network === "testnet" ? "mainnet" : "testnet";
}

export function suiscanTxUrl(digest: string, network: Network): string {
  return `https://suiscan.xyz/${network}/tx/${digest}`;
}

export function suiscanObjectUrl(id: string, network: Network): string {
  return `https://suiscan.xyz/${network}/object/${id}`;
}
