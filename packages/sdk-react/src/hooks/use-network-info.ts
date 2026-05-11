import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type NetworkInfoResult = EdenData<
  ReturnType<EdenClient["v1"]["network"]["get"]>
>;
type Options = Omit<UseQueryOptions<NetworkInfoResult>, "queryKey" | "queryFn">;

export function useNetworkInfo(
  opts?: Options,
): UseQueryResult<NetworkInfoResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.networkInfo(),
    queryFn: async () => {
      const { data, error } = await eden.v1.network.get();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    ...opts,
  });
}
