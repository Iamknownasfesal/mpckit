import type { EdenClient, EdenData } from "@mpckit/sdk/eden";
import {
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { useEdenClient } from "../provider";
import { mpcKitQueryKeys } from "../query-keys";

// `eden.v1.dwallets` is callable (`.dwallets({ id })`) for the param
// route and also indexable (`.dwallets.get()`) for the list route. We
// want the typed sub-client returned when called with a param, then
// its `.get()` payload.
type DWalletResult = EdenData<
  ReturnType<ReturnType<EdenClient["v1"]["dwallets"]>["get"]>
>;
type Options = Omit<UseQueryOptions<DWalletResult>, "queryKey" | "queryFn">;

export function useDWallet(
  id: string | undefined,
  opts?: Options,
): UseQueryResult<DWalletResult> {
  const eden = useEdenClient();
  return useQuery({
    queryKey: mpcKitQueryKeys.dwallet(id ?? ""),
    queryFn: async () => {
      const { data, error } = await eden.v1
        .dwallets({ id: id as string })
        .get();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(id),
    ...opts,
  });
}
