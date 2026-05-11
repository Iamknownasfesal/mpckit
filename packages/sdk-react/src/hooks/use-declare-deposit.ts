import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type DeclareDepositResult = EdenData<
  ReturnType<EdenClient["v1"]["billing"]["deposit"]["post"]>
>;
type Options = UseMutationOptions<DeclareDepositResult, Error, string>;

export function useDeclareDeposit(
  opts?: Options,
): UseMutationResult<DeclareDepositResult, Error, string> {
  const eden = useEdenClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (txDigest: string) => {
      const { data, error } = await eden.v1.billing.deposit.post({ txDigest });
      if (error) throw error;
      return data;
    },
    ...opts,
    onSuccess: (data, vars, onMutateResult, ctx) => {
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.balance() });
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.billingHistory() });
      return opts?.onSuccess?.(data, vars, onMutateResult, ctx);
    },
  });
}
