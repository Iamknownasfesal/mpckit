import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

interface BalanceResult {
  creditsMicro: string;
  creditsUsd: string;
}

type Options = Omit<UseQueryOptions<BalanceResult>, "queryKey" | "queryFn">;

export function useBalance(opts?: Options): UseQueryResult<BalanceResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.balance(),
    queryFn: async () => {
      const { data, error } = await eden.v1.billing.balance.get();
      if (error) throw error;
      return data;
    },
    ...opts,
  });
}
