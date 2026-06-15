import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";

export interface AccountDetail {
  address: string;
  balance: string;
  nonce: number;
  latestBlockNum?: number;
  code?: string;
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

/** CIRRUS Certificate directory — the network's known accounts. */
export function useCertificates(limit = 100) {
  return useQuery({
    queryKey: ["certificates", limit],
    queryFn: async (): Promise<CertificateRecord[]> => {
      const { data } = await api.get(`${env.CIRRUS_URL}/Certificate`, {
        params: {
          select: "commonName,organization,organizationalUnit,userAddress,isValid",
          limit,
        },
      });
      return Array.isArray(data) ? data : [];
    },
  });
}
