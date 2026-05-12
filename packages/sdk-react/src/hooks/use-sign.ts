import type { MPCKitError, SignArgs, SignResult } from "@mpckit/sdk";
import {
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMPCKit } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type Options = UseMutationOptions<SignResult, MPCKitError, SignArgs>;

export function useSign(
  opts?: Options,
): UseMutationResult<SignResult, MPCKitError, SignArgs> {
  const api = useMPCKit();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: SignArgs) => api.sign(args),
    ...opts,
    onSuccess: (data, vars, onMutateResult, ctx) => {
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.balance() });
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.billingHistory() });
      return opts?.onSuccess?.(data, vars, onMutateResult, ctx);
    },
  });
}
