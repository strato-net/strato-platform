import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import type { Token } from "@/interface";

/** Canonical query key for GET /tokens/balance (full user list). */
export const USER_TOKEN_BALANCES_QUERY_KEY = ["user", "token-balances"] as const;

export function normalizeTokenAddress(addr: string): string {
  return (addr || "").toLowerCase().replace(/^0x/, "");
}

export async function fetchUserTokenBalances(signal?: AbortSignal): Promise<Token[]> {
  const { data } = await api.get<Token[]>("/tokens/balance", { signal });
  return Array.isArray(data) ? data : [];
}

/** Returns balance string if the token row exists; null if not in list. */
export function findBalanceInTokenList(
  list: Token[] | undefined,
  rawAddress: string,
): string | null {
  if (!list?.length) return null;
  const needle = normalizeTokenAddress(rawAddress);
  const row = list.find((t) => {
    const top = normalizeTokenAddress(t.address || "");
    const nested = t.token?.address ? normalizeTokenAddress(t.token.address) : "";
    return top === needle || nested === needle;
  });
  if (!row) return null;
  const b = row.balance;
  if (b == null || b === "") return "0";
  return String(b);
}

export function invalidateUserTokenBalances(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: USER_TOKEN_BALANCES_QUERY_KEY });
}

/**
 * Single-token balance via GET /tokens/balance?address=eq.{addr}.
 * Use for swap / USDST where the filtered response must always be requested.
 */
export async function getBalanceForAddressFiltered(
  tokenAddress: string,
  signal?: AbortSignal,
): Promise<string> {
  const addr = tokenAddress.startsWith("0x") ? tokenAddress.slice(2) : tokenAddress;
  const { data } = await api.get<Token[]>(`/tokens/balance?address=eq.${addr}`, { signal });
  return data?.[0]?.balance != null ? String(data[0].balance) : "0";
}

/**
 * One token balance: prefer shared GET /tokens/balance list (React Query cache);
 * only call GET /tokens/balance?address=eq.{addr} when the token is missing from that list.
 */
export async function getBalanceForAddressPreferSharedList(
  queryClient: QueryClient,
  tokenAddress: string,
  signal?: AbortSignal,
): Promise<string> {
  const addr = tokenAddress.startsWith("0x") ? tokenAddress.slice(2) : tokenAddress;

  let list = queryClient.getQueryData<Token[]>(USER_TOKEN_BALANCES_QUERY_KEY);
  if (!list?.length) {
    try {
      list = await queryClient.fetchQuery({
        queryKey: USER_TOKEN_BALANCES_QUERY_KEY,
        queryFn: ({ signal: qSignal }) => fetchUserTokenBalances(qSignal),
      });
    } catch {
      list = [];
    }
  }

  const fromList =
    findBalanceInTokenList(list, addr) ?? findBalanceInTokenList(list, tokenAddress);
  if (fromList !== null) return fromList;

  const { data } = await api.get<Token[]>(`/tokens/balance?address=eq.${addr}`, { signal });
  return data?.[0]?.balance != null ? String(data[0].balance) : "0";
}
