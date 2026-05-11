import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type PricingResult = EdenData<
  ReturnType<EdenClient["v1"]["billing"]["pricing"]["get"]>
>;
type Options = Omit<UseQueryOptions<PricingResult>, "queryKey" | "queryFn">;

export function usePricing(opts?: Options): UseQueryResult<PricingResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.pricing(),
    queryFn: async () => {
      const { data, error } = await eden.v1.billing.pricing.get();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    ...opts,
  });
}
