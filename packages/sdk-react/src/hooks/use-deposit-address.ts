import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type DepositAddressResult = EdenData<
  ReturnType<EdenClient["v1"]["billing"]["address"]["get"]>
>;
type Options = Omit<
  UseQueryOptions<DepositAddressResult>,
  "queryKey" | "queryFn"
>;

export function useDepositAddress(
  opts?: Options,
): UseQueryResult<DepositAddressResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.depositAddress(),
    queryFn: async () => {
      const { data, error } = await eden.v1.billing.address.get();
      if (error) throw error;
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    ...opts,
  });
}
