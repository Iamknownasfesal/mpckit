/**
 * Per-network IkaClient lookup. Backed by the network registry, which
 * lazily constructs + initialises each client on first call.
 */
import type { IkaNetwork } from "@/config/env";
import { getNetwork } from "@/shared/networks/registry";
import type { IkaClient, getNetworkConfig } from "@ika.xyz/sdk";

export function getIkaClient(network: IkaNetwork): Promise<IkaClient> {
  return getNetwork(network).ika();
}

export function getIkaConfig(
  network: IkaNetwork,
): ReturnType<typeof getNetworkConfig> {
  return getNetwork(network).ikaConfig;
}
