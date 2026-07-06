import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { strip0x } from "@/services/userWallets";

export interface TokenBalance {
  /** Token contract address (transfer target). */
  address: string;
  symbol: string;
  decimals: number;
  /** Raw balance in the token's smallest units (string to preserve precision). */
  balance: string;
}

function toRawString(value: unknown): string {
  if (typeof value === "number") {
    // JSON parses large balances as (possibly imprecise) numbers; coerce to an
    // integer bigint string. The node enforces the exact balance on transfer.
    try {
      return BigInt(Math.round(value)).toString();
    } catch {
      return "0";
    }
  }
  return String(value ?? "0");
}

/**
 * Fungible tokens the account holds a positive balance of. Token balances live in
 * each token's `_balances` mapping (active tokens have status 2), exposed by cirrus
 * via the `mapping` table; we inner-join `storage` for the symbol and decimals:
 *   /cirrus/search/mapping?collection_name=eq._balances&storage.data->>status=eq.2
 *     &key->>key=eq.<addr>&value=gt.0&select=address,value,storage!inner(data->>_symbol,data->>customDecimals)
 */
export function useMyTokens(ownerAddress?: string | null) {
  return useQuery({
    queryKey: ["my-tokens", ownerAddress],
    enabled: !!ownerAddress,
    queryFn: async (): Promise<TokenBalance[]> => {
      const key = strip0x(ownerAddress!);
      const { data } = await api.get(
        `${env.CIRRUS_URL}/mapping?collection_name=eq._balances` +
          `&storage.data-%3E%3Estatus=eq.2&key-%3E%3Ekey=eq.${key}&value=gt.0` +
          `&select=address,value,storage!inner(data-%3E%3E_symbol,data-%3E%3EcustomDecimals)`
      );
      if (!Array.isArray(data)) return [];
      return data
        .map((row: any) => ({
          address: row?.address ?? "",
          symbol: row?.storage?._symbol ?? "TOKEN",
          decimals: Number(row?.storage?.customDecimals ?? 18),
          balance: toRawString(row?.value),
        }))
        .filter((t) => t.address);
    },
    refetchInterval: 15000,
  });
}
