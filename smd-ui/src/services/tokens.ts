import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { strip0x, TOKEN_FACTORY_ADDRESS } from "@/services/userWallets";

export interface TokenBalance {
  /** Token contract address (transfer target). */
  address: string;
  symbol: string;
  decimals: number;
  /** Raw balance in the token's smallest units (string to preserve precision). */
  balance: string;
  /** Registered in the token factory. Anything else names itself, so its symbol is not shown. */
  verified: boolean;
}

export const tokenLabel = (token: TokenBalance): string =>
  token.verified ? token.symbol : `Unverified 0x${strip0x(token.address)}`;

export type TokenMetadata = Omit<TokenBalance, "balance" | "verified">;

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
          `&select=address,value::text,storage!inner(data-%3E%3E_symbol,data-%3E%3EcustomDecimals)`
      );
      if (!Array.isArray(data) || !data.length) return [];
      // A failed lookup leaves every holding unverified instead of hiding the balances.
      const { data: registered } = await api.get(
        `${env.CIRRUS_URL}/mapping?address=eq.${TOKEN_FACTORY_ADDRESS}&collection_name=eq.isFactoryToken` +
          `&key-%3E%3Ekey=in.(${data.map((row: any) => strip0x(String(row?.address ?? ""))).join(",")})` +
          `&value=eq.true&select=key`,
        { skipErrorToast: true }
      ).catch(() => ({ data: [] }));
      const factoryTokens = new Set(
        (Array.isArray(registered) ? registered : []).map((row: any) => strip0x(String(row?.key?.key ?? "")))
      );
      return data
        .map((row: any) => ({
          address: row?.address ?? "",
          symbol: row?.storage?._symbol ?? "TOKEN",
          decimals: Number(row?.storage?.customDecimals ?? 18),
          balance: toRawString(row?.value),
          verified: factoryTokens.has(strip0x(String(row?.address ?? ""))),
        }))
        .filter((t) => t.address)
        .sort((left, right) => Number(right.verified) - Number(left.verified));
    },
    refetchInterval: 15000,
  });
}

/**
 * Token names and decimals by contract address, independent of the wallet's balance.
 * Only tokens registered in the token factory are returned, so a contract cannot name itself as one.
 */
export function useTokenMetadata(addresses: string[]) {
  const normalized = [...new Set(addresses.map(strip0x).filter((address) => /^[0-9a-f]{40}$/.test(address)))].sort();
  return useQuery({
    queryKey: ["token-metadata", normalized],
    enabled: normalized.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<TokenMetadata[]> => {
      const [{ data }, { data: registered }] = await Promise.all([
        api.get(
          `${env.CIRRUS_URL}/storage?address=in.(${normalized.join(",")})` +
            `&select=address,data-%3E%3E_symbol,data-%3E%3EcustomDecimals`
        ),
        api.get(
          `${env.CIRRUS_URL}/mapping?address=eq.${TOKEN_FACTORY_ADDRESS}&collection_name=eq.isFactoryToken` +
            `&key-%3E%3Ekey=in.(${normalized.join(",")})&value=eq.true&select=key`
        ),
      ]);
      if (!Array.isArray(data) || !Array.isArray(registered)) return [];
      const factoryTokens = new Set(registered.map((row: any) => strip0x(String(row?.key?.key ?? ""))));
      return data.map((row: any) => ({
        address: strip0x(String(row?.address ?? "")),
        symbol: String(row?._symbol ?? row?.data?._symbol ?? "TOKEN"),
        decimals: Number(row?.customDecimals ?? row?.data?.customDecimals ?? 18),
      })).filter((token) => factoryTokens.has(token.address));
    },
  });
}

/** Batch allowance lookup for multi-coin liquidity workflows. Order matches `tokenAddresses`. */
export function useTokenAllowances(
  tokenAddresses: string[],
  ownerAddress?: string | null,
  spenderAddress?: string | null
) {
  const tokens = tokenAddresses.map(strip0x);
  return useQuery({
    queryKey: ["token-allowances", ownerAddress, spenderAddress, tokens],
    enabled: tokens.length > 0 && tokens.every((token) => token.length === 40) &&
      !!ownerAddress && !!spenderAddress,
    refetchInterval: 12_000,
    queryFn: async (): Promise<string[]> => {
      const owner = strip0x(ownerAddress!);
      const spender = strip0x(spenderAddress!);
      return Promise.all(tokens.map(async (token) => {
        const { data } = await api.get(
          `${env.CIRRUS_URL}/mapping?collection_name=eq._allowances` +
            `&address=eq.${token}&key-%3E%3Ekey=eq.${owner}` +
            `&key-%3E%3Ekey2=eq.${spender}&select=value::text&limit=1`
        );
        return String(Array.isArray(data) ? data[0]?.value ?? "0" : "0");
      }));
    },
  });
}
