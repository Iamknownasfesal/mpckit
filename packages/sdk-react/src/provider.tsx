/**
 * `MPCKitProvider` constructs a single `MPCKit` instance for the React
 * tree, optionally wiring up a Web Worker crypto engine so DKG and
 * sign ceremonies run off the main thread. The instance is exposed via
 * context so hooks can call into it without prop drilling.
 *
 * The consumer owns the `QueryClient` (via `<QueryClientProvider/>`).
 * That keeps caching / devtools / error handling decisions in app-land
 * where they belong, and avoids hidden duplicate clients.
 *
 * Worker construction differs across bundlers (Vite, Webpack, Next.js
 * Turbopack), so we accept a `workerFactory` callback rather than
 * trying to resolve `worker-impl` ourselves.
 */
import {
  type CryptoEngine,
  createWebWorkerCryptoEngine,
  defaultBaseUrl,
  MPCKit,
  type MPCKitOptions,
} from "@mpckit/sdk";
import { createEdenClient, type EdenClient } from "@mpckit/sdk/eden";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

export interface MPCKitProviderProps {
  options: Omit<MPCKitOptions, "crypto">;
  /**
   * Drive crypto from a Web Worker constructed via `workerFactory`.
   * Required for browser apps that can't afford to block the main
   * thread on WASM. Server-side renders should leave this off.
   */
  useWorker?: boolean;
  /**
   * Bundler-specific Worker constructor. Typical Vite shape:
   *
   *   () => new Worker(
   *     new URL("@mpckit/sdk/worker-impl", import.meta.url),
   *     { type: "module" },
   *   )
   */
  workerFactory?: () => Worker;
  /** Override the crypto engine entirely (testing, custom adapters). */
  crypto?: CryptoEngine;
  children: ReactNode;
}

interface ApiBundle {
  api: MPCKit;
  eden: EdenClient;
  worker: Worker | null;
}

const MPCKitContext = createContext<ApiBundle | null>(null);

export function MPCKitProvider({
  options,
  useWorker,
  workerFactory,
  crypto,
  children,
}: MPCKitProviderProps) {
  const bundleRef = useRef<ApiBundle | null>(null);

  const bundle = useMemo<ApiBundle>(() => {
    bundleRef.current?.worker?.terminate();
    let engine = crypto;
    let worker: Worker | null = null;
    if (!engine && useWorker) {
      if (!workerFactory) {
        throw new Error(
          "MPCKitProvider: useWorker requires workerFactory; pass `() => new Worker(new URL('@mpckit/sdk/worker-impl', import.meta.url), { type: 'module' })`",
        );
      }
      worker = workerFactory();
      engine = createWebWorkerCryptoEngine(worker);
    }
    const api = new MPCKit(engine ? { ...options, crypto: engine } : options);
    // Eden treaty mirrors the same baseUrl + apiKey: it's a typed
    // alternative to the MPCKit class for raw HTTP calls. Hooks that
    // don't need ceremony orchestration prefer this so refactors on
    // the backend become compile-time errors here.
    const eden = createEdenClient({
      baseUrl: options.baseUrl ?? defaultBaseUrl(options.network),
      apiKey: options.apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const next: ApiBundle = { api, eden, worker };
    bundleRef.current = next;
    return next;
  }, [options, useWorker, workerFactory, crypto]);

  useEffect(() => {
    return () => {
      bundleRef.current?.worker?.terminate();
      bundleRef.current = null;
    };
  }, []);

  return (
    <MPCKitContext.Provider value={bundle}>{children}</MPCKitContext.Provider>
  );
}

function useBundle(): ApiBundle {
  const bundle = useContext(MPCKitContext);
  if (!bundle) {
    throw new Error("useMPCKit must be used inside <MPCKitProvider>");
  }
  return bundle;
}

export function useMPCKit(): MPCKit {
  return useBundle().api;
}

/**
 * Type-safe Eden treaty client. Use this for routes that don't need
 * the MPCKit orchestration helpers — every method is inferred from the
 * backend's exact App type.
 *
 * Example:
 *
 *   const eden = useEdenClient();
 *   const { data, error } = await eden.v1.billing.balance.get();
 */
export function useEdenClient(): EdenClient {
  return useBundle().eden;
}
