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
  const row = list.find((t) => normalizeTokenAddress(t.address) === needle);
  if (!row) return null;
  const b = row.balance;
  if (b == null || b === "") return "0";
  return String(b);
}

export function invalidateUserTokenBalances(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: USER_TOKEN_BALANCES_QUERY_KEY });
}
