/**
 * Per-network client registry.
 *
 * A single backend serves any subset of {testnet, mainnet}. For each
 * enabled network we own one Sui gRPC client and a lazily-initialised
 * IkaClient. Route handlers look up the right context via
 * `getNetwork(requestNetwork(request))`; workers loop over
 * `enabledNetworks()` to schedule per-network jobs.
 *
 * Hot wallet stays network-agnostic (the same Ed25519 keypair derives
 * the same address on both chains). Submission, gas station, and SDK
 * config are per-network.
 */

import { getNetworkConfig, IkaClient } from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  enabledNetworks,
  type IkaNetwork,
  type NetworkEnv,
  networkEnv,
} from "@/config/env";

export type { IkaNetwork } from "@/config/env";

export interface NetworkContext {
  network: IkaNetwork;
  sui: SuiGrpcClient;
  ika(): Promise<IkaClient>;
  ikaConfig: ReturnType<typeof getNetworkConfig>;
  core: {
    packageId: string;
    operatorCapId: string;
    adminCapId: string;
    treasuryId: string;
  };
  gasStation: { url: string; auth: string };
}

class NetworkContextImpl implements NetworkContext {
  readonly network: IkaNetwork;
  readonly sui: SuiGrpcClient;
  readonly ikaConfig: ReturnType<typeof getNetworkConfig>;
  readonly core: NetworkContext["core"];
  readonly gasStation: NetworkContext["gasStation"];

  private _ika: IkaClient | undefined;
  private _ikaInit: Promise<IkaClient> | undefined;

  constructor(cfg: NetworkEnv) {
    this.network = cfg.network;
    this.sui = new SuiGrpcClient({
      network: cfg.network,
      baseUrl: cfg.suiGrpcUrl,
    });
    this.ikaConfig = getNetworkConfig(cfg.network);
    this.core = {
      packageId: cfg.packageId,
      operatorCapId: cfg.operatorCapId,
      adminCapId: cfg.adminCapId,
      treasuryId: cfg.treasuryId,
    };
    this.gasStation = { url: cfg.gasStationUrl, auth: cfg.gasStationAuth };
  }

  async ika(): Promise<IkaClient> {
    if (this._ika) return this._ika;
    if (!this._ikaInit) {
      this._ikaInit = (async () => {
        const c = new IkaClient({
          suiClient: this.sui,
          config: this.ikaConfig,
          cache: true,
        });
        await c.initialize();
        this._ika = c;
        return c;
      })();
    }
    return this._ikaInit;
  }
}

const _contexts = new Map<IkaNetwork, NetworkContextImpl>();

function ensureLoaded(): void {
  if (_contexts.size > 0) return;
  for (const net of enabledNetworks()) {
    const cfg = networkEnv(net);
    if (!cfg) continue;
    _contexts.set(net, new NetworkContextImpl(cfg));
  }
  if (_contexts.size === 0) {
    throw new Error(
      "network registry: no networks enabled — set MPCKITCORE_<NET>_PACKAGE_ID + caps + treasury + gas station for at least one of testnet, mainnet",
    );
  }
}

/** Resolve the context for a given network, throwing if not enabled. */
export function getNetwork(net: IkaNetwork): NetworkContext {
  ensureLoaded();
  const ctx = _contexts.get(net);
  if (!ctx) {
    throw new Error(
      `network "${net}" is not enabled on this backend (enabled: ${[..._contexts.keys()].join(", ")})`,
    );
  }
  return ctx;
}

/** Whether a network is enabled. */
export function hasNetwork(net: IkaNetwork): boolean {
  ensureLoaded();
  return _contexts.has(net);
}

/** Enabled networks in deterministic order. */
export function listNetworks(): IkaNetwork[] {
  ensureLoaded();
  return [..._contexts.keys()];
}

/** Eager-initialise IkaClients for every enabled network. */
export async function warmupNetworks(): Promise<void> {
  ensureLoaded();
  await Promise.all([..._contexts.values()].map((c) => c.ika()));
}

/** Test-only: drop cached contexts so a fresh env takes effect. */
export function _resetNetworkRegistryForTest(): void {
  _contexts.clear();
}
