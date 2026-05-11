import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type HistoryResult = EdenData<
  ReturnType<EdenClient["v1"]["billing"]["history"]["get"]>
>;
type Options = Omit<UseQueryOptions<HistoryResult>, "queryKey" | "queryFn">;

export function useBillingHistory(
  opts?: Options,
): UseQueryResult<HistoryResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.billingHistory(),
    queryFn: async () => {
      const { data, error } = await eden.v1.billing.history.get();
      if (error) throw error;
      return data;
    },
    ...opts,
  });
}
