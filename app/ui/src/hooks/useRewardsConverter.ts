import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GovernedCallResult } from "@strato/shared-types";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { rewardsConverterService } from "@/services/rewardsConverterService";

const KEY = "rewardsConverter";
const STATE_REFETCH_MS = 15_000;
// Cirrus indexes a block shortly after its receipt, so a second refresh picks up what the first missed.
const INDEX_LAG_MS = 3_000;

/** Converter state for everyone, guests included. Polls, so a governed change shows up on its own. */
export function useRewardsConverterState() {
  return useQuery({
    queryKey: [KEY, "state"],
    queryFn: ({ signal }) => rewardsConverterService.getState(signal),
    refetchInterval: STATE_REFETCH_MS,
  });
}

/** True once the state says this network has a converter and an account is signed in. */
function useSignedInWithConverter(): boolean {
  const { isLoggedIn, userAddress } = useUser();
  const { data } = useRewardsConverterState();
  return data?.configured === true && isLoggedIn && !!userAddress;
}

/** The signed-in account's rewards-token balance and lifetime totals. */
export function useRewardsConverterAccount() {
  const { userAddress } = useUser();
  const enabled = useSignedInWithConverter();
  return useQuery({
    queryKey: [KEY, "account", userAddress],
    queryFn: ({ signal }) => rewardsConverterService.getAccount(signal),
    enabled,
  });
}

/** One page of the signed-in account's conversions, newest first. Pass `enabled: false` while it is collapsed. */
export function useRewardsConverterHistory({ page, limit, enabled = true }: {
  page: number;
  limit: number;
  enabled?: boolean;
}) {
  const { userAddress } = useUser();
  const signedIn = useSignedInWithConverter();
  return useQuery({
    queryKey: [KEY, "history", userAddress, page, limit],
    queryFn: ({ signal }) => rewardsConverterService.getHistory(page, limit, signal),
    enabled: signedIn && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useRewardsConverterAdminStats() {
  const enabled = useSignedInWithConverter();
  return useQuery({
    queryKey: [KEY, "admin", "stats"],
    queryFn: ({ signal }) => rewardsConverterService.getAdminStats(signal),
    enabled,
  });
}

/** The transaction that executed the issue `voteHash` voted on. Asks again until the indexer has it. */
export function useIssueExecutionHash(voteHash: string, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, "admin", "issueExecution", voteHash],
    queryFn: ({ signal }) => rewardsConverterService.getIssueExecutionHash(voteHash, signal),
    enabled,
    staleTime: Infinity,
    refetchInterval: (query) => (query.state.data ? false : INDEX_LAG_MS),
  });
}

// A loaded series stays for the session: only a converter transaction made here refetches it.
const SESSION_CACHE = { staleTime: Infinity, gcTime: Infinity };

/** Volume per UTC day of `month` ("YYYY-MM"). No request while `enabled` is false; each month is cached. */
export function useRewardsConverterDailyVolume(month: string, enabled: boolean) {
  const signedIn = useSignedInWithConverter();
  return useQuery({
    queryKey: [KEY, "admin", "volume", "daily", month],
    queryFn: ({ signal }) => rewardsConverterService.getDailyVolume(month, signal),
    enabled: signedIn && enabled,
    ...SESSION_CACHE,
  });
}

/** Volume per UTC month since the first conversion. No request while `enabled` is false. */
export function useRewardsConverterMonthlyVolume(enabled: boolean) {
  const signedIn = useSignedInWithConverter();
  return useQuery({
    queryKey: [KEY, "admin", "volume", "monthly"],
    queryFn: ({ signal }) => rewardsConverterService.getMonthlyVolume(signal),
    enabled: signedIn && enabled,
    ...SESSION_CACHE,
  });
}

/** Refetches every converter query in use; the mutation stays pending until the first pass lands. */
function useRefreshConverter() {
  const queryClient = useQueryClient();
  return () => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
    setTimeout(refresh, INDEX_LAG_MS);
    return refresh();
  };
}

/** Converts a raw rewards-token amount, then refreshes state, account view, history and the app's token balances. */
export function useConvertRewards() {
  const refresh = useRefreshConverter();
  const { fetchTokens } = useUserTokens();
  return useMutation({
    mutationFn: (amount: bigint) => rewardsConverterService.convert(amount),
    onSuccess: () => Promise.all([refresh(), fetchTokens()]),
  });
}

function useGovernedCall<TVariables>(mutationFn: (variables: TVariables) => Promise<GovernedCallResult>) {
  const refresh = useRefreshConverter();
  return useMutation({ mutationFn, onSuccess: refresh });
}

/** Governed `setRate` with a raw 18-decimal rate. */
export const useSetConverterRate = () => useGovernedCall(rewardsConverterService.setRate);

export const usePauseConverter = () => useGovernedCall<void>(rewardsConverterService.pause);

export const useUnpauseConverter = () => useGovernedCall<void>(rewardsConverterService.unpause);

/** Governed `withdrawReserve` of a raw STRATO amount to `to`. */
export const useWithdrawConverterReserve = () =>
  useGovernedCall(({ to, amount }: { to: string; amount: bigint }) =>
    rewardsConverterService.withdrawReserve(to, amount));

/** Funding: a governed mint of a raw STRATO amount to the converter. */
export const useFundConverterReserve = () => useGovernedCall(rewardsConverterService.fundReserve);
