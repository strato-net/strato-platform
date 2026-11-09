import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { vestingEnabled } from "@/lib/constants";

export type VestingStatus = "not_started" | "vesting" | "paused" | "cancelled" | "fully_vested" | "complete";

/** One VestingPool row as computed by GET /api/vesting. Amounts are decimal strings in atoms (18 decimals). */
export interface VestingView {
  vestingId: string;
  account: string;
  managed: boolean;
  cancelled: boolean;
  curveType: number;
  durationWeeks: number;
  durationSeconds: number;
  startDate: number;
  endDate: number;
  pausingDate: number;
  amount: string;
  amountClaimed: string;
  vested: string;
  claimable: string;
  locked: string;
  // Unvested remainder returned to the pool by a cancel; "0" otherwise. locked is 0 when cancelled.
  returned: string;
  ratePerSecond: string;
  status: VestingStatus;
}

export interface VestingSummary {
  amount: string;
  vested: string;
  claimed: string;
  claimable: string;
  locked: string;
  returned: string;
}

export interface VestingsResponse {
  pool: string | null;
  vestings: VestingView[];
  summary: VestingSummary;
}

export const vestingsQueryKey = (userAddress: string | null | undefined) => ["vestings", userAddress ?? null];

/**
 * Vestings of the resolved identity (vault address, or the guest wallet for which
 * axios already sends X-Wallet-Address). Off until the flag and an identity exist; a
 * network without a configured pool answers with `pool: null` and no rows, which hides the tab.
 */
export function useVestings() {
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
