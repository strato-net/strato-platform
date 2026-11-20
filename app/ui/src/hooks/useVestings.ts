import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { vestingEnabled } from "@/lib/constants";

import type { VestingStatus, VestingSummary, VestingView, VestingsResponse } from "@strato/shared-types";

export type { VestingStatus, VestingSummary, VestingView, VestingsResponse };

export const vestingsQueryKey = (userAddress: string | null | undefined) => ["vestings", userAddress ?? null];

/**
 * Vestings of the resolved identity (vault address, or the guest wallet for which
 * axios already sends X-Wallet-Address). Off until the flag and an identity exist; a
 * network without a configured pool answers with `pool: null` and no rows, which hides the tab.
 */
interface UseVestingsOptions {
  /** Poll every minute while mounted: the page wants live amounts, the nav only needs to know rows exist. */
  poll?: boolean;
}

export function useVestings({ poll = false }: UseVestingsOptions = {}) {
  const { userAddress } = useUser();
  const enabled = vestingEnabled && !!userAddress;

  const query = useQuery({
    queryKey: vestingsQueryKey(userAddress),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<VestingsResponse>("/vesting", { signal });
      return data;
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Accrual, claimability and admin pause/cancel change while the page sits open; staleTime alone
    // never refetches. Only the page polls; the nav items share the cache without adding load.
    refetchInterval: poll ? 60_000 : false,
    retry: 1,
  });

  const vestings = enabled ? query.data?.vestings ?? [] : [];
  const summary = enabled ? query.data?.summary ?? null : null;
  const pool = enabled ? query.data?.pool ?? null : null;

  return {
    vestings,
    summary,
    pool,
    hasVesting: vestings.length > 0,
    enabled,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
