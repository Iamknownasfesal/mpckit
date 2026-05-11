import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type DWalletsResult = EdenData<ReturnType<EdenClient["v1"]["dwallets"]["get"]>>;
type Options = Omit<UseQueryOptions<DWalletsResult>, "queryKey" | "queryFn">;

export function useDWallets(opts?: Options): UseQueryResult<DWalletsResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.dwallets(),
    queryFn: async () => {
      const { data, error } = await eden.v1.dwallets.get();
      if (error) throw error;
      return data;
    },
    ...opts,
  });
}
