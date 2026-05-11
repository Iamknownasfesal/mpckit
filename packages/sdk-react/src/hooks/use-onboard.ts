/**
 * `useOnboard` runs the full zero-trust DKG ceremony (encryption-key
 * registration, DKG, accept) end-to-end. On success, invalidates the
 * dwallet list and balance queries so consumers see the new dwallet
 * and the credit charge without manual refetching.
 */
import type { MpcKitError, OnboardArgs, OnboardResult } from "@mpckit/sdk";
import {
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMpcKit } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

type Options = UseMutationOptions<OnboardResult, MpcKitError, OnboardArgs>;

export function useOnboard(
  opts?: Options,
): UseMutationResult<OnboardResult, MpcKitError, OnboardArgs> {
  const api = useMpcKit();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: OnboardArgs) => api.onboard(args),
    ...opts,
    onSuccess: (data, vars, onMutateResult, ctx) => {
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.dwallets() });
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.balance() });
      qc.invalidateQueries({ queryKey: mpcKitQueryKeys.billingHistory() });
      return opts?.onSuccess?.(data, vars, onMutateResult, ctx);
    },
  });
}
