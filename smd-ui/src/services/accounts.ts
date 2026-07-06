import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";

export interface AccountDetail {
  address: string;
  balance: string;
  nonce: number;
  latestBlockNum?: number;
  code?: string;
  contractName?: string | null;
  codeHash?: string;
}

export interface CertificateRecord {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  userAddress: string;
  isValid?: boolean;
}

/** GET /strato-api/eth/v1.2/account?address= — returns an array; element 0 is the account. */
export function useAccountDetail(address: string | null | undefined) {
  return useQuery({
    queryKey: ["account", address],
    enabled: !!address,
    queryFn: async (): Promise<AccountDetail | null> => {
      const { data } = await api.get(`${env.STRATO_URL}/account`, {
        params: { address: (address || "").replace(/^0x/, "") },
      });
      return Array.isArray(data) ? data[0] ?? null : (data?.["0"] ?? null);
    },
    refetchInterval: 15000,
  });
}

export interface UserRecord {
  username: string;
  address: string;
}

function extractUsername(row: any): string {
  const storage = row?.storage;
  const data = Array.isArray(storage) ? storage[0]?.data : storage?.data;
  return data?.username ?? row?.["storage.data.username"] ?? "";
}

/**
 * Registered users on the network, from the `User` contract's Cirrus state:
 *   /cirrus/search/contract?contract_name=eq.User&storage.data->>username=neq.&select=*,storage(*)
 * username comes from storage.data.username; address is the User contract address.
 */
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async (): Promise<UserRecord[]> => {
      const { data } = await api.get(
        `${env.CIRRUS_URL}/contract?contract_name=eq.User&storage.data->>username=neq.&select=*,storage(*)`
      );
      if (!Array.isArray(data)) return [];
      return data
        .map((row) => ({ username: extractUsername(row), address: row?.address ?? "" }))
        .filter((u) => u.username);
    },
  });
}

/**
 * Search registered users by username (ilike) — same `User` contract logic as the
 * Accounts tab, filtered to usernames matching `*term*`.
 */
export async function searchUsers(term: string): Promise<UserRecord[]> {
  const pattern = encodeURIComponent(`*${term}*`);
  const { data } = await api.get(
    `${env.CIRRUS_URL}/contract?contract_name=eq.User&storage.data->>username=ilike.${pattern}&select=*,storage(*)`
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => ({ username: extractUsername(row), address: row?.address ?? "" }))
    .filter((u) => u.username);
}

/** Live username search (for recipient autocomplete); runs once `term` is >= 2 chars. */
export function useUserSearch(term: string) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: ["user-search", trimmed],
    enabled: trimmed.length >= 2,
    queryFn: () => searchUsers(trimmed),
    staleTime: 10_000,
  });
}
