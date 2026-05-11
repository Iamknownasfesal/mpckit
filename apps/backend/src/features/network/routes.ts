import { getNetworkInfo } from "@/features/network/service";
import { getIkaConfig } from "@/shared/ika/client";
import { listNetworks } from "@/shared/networks/registry";
import { getHotWallet } from "@/shared/sui/hot-wallet";
import { Elysia } from "elysia";

export const networkRoutes = new Elysia({ prefix: "/v1" }).get(
  "/network",
  async () => {
    const operatorAddress = getHotWallet().address();
    const networks = await Promise.all(
      listNetworks().map(async (network) => {
        const cfg = getIkaConfig(network);
        const info = await getNetworkInfo(network);
        return {
          network,
          packages: {
            ikaPackage: cfg.packages.ikaPackage,
            ikaDwallet2pcMpcPackage: cfg.packages.ikaDwallet2pcMpcPackage,
          },
          objects: {
            coordinator: cfg.objects.ikaDWalletCoordinator.objectID,
            system: cfg.objects.ikaSystemObject.objectID,
          },
          latestEncryptionKey: {
            id: info.encryptionKeyId,
            epoch: info.epoch,
            loadedAt: info.loadedAt,
          },
        };
      }),
    );
    return { operatorAddress, networks };
  },
  {
    detail: {
      tags: ["network"],
      summary: "Network introspection",
      description:
        "Operator address plus, for every enabled Sui network on this backend, the deployed package + object ids and the latest network encryption key the SDK should bind to. SDKs read this on first contact to learn which networks the backend serves.",
    },
  },
);
