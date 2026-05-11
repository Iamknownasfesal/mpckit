/**
 * Per-network Sui gRPC client lookup. Delegates to the network
 * registry — every caller passes the network the request is bound to.
 *
 * Transport is gRPC only (JSON-RPC and WebSocket are deprecated
 * upstream). Endpoint defaults to the Mysten public fullnode for each
 * network, overridable via SUI_GRPC_URL_<NET>.
 */
import type { IkaNetwork } from "@/config/env";
import { getNetwork } from "@/shared/networks/registry";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

export function getSuiClient(network: IkaNetwork): SuiGrpcClient {
  return getNetwork(network).sui;
}
