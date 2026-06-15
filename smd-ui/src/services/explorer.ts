import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env, runtime } from "@/lib/env";

export interface BlockData {
  number?: number | string;
  hash?: string;
  parentHash?: string;
  difficulty?: number | string;
  nonce?: string;
  timestamp?: string;
  gasUsed?: number | string;
  gasLimit?: number | string;
}
export interface Block {
  blockData?: BlockData;
  hash?: string;
  receiptTransactions?: Transaction[];
  transactions?: Transaction[];
}
export interface Transaction {
  hash?: string;
  from?: string;
  to?: string;
  value?: string | number;
  gasLimit?: number | string;
  gasPrice?: number | string;
  nonce?: number | string;
  transactionType?: string;
  timestamp?: string;
  blockNumber?: number | string;
}

const chainParam = () => {
  const id = runtime.chainId();
  return id ? { chainid: id } : {};
};

export function useBlocks(count = 15) {
  return useQuery({
    queryKey: ["blocks", count],
    queryFn: async (): Promise<Block[]> => {
      const { data } = await api.get(`${env.STRATO_URL}/block/last/${count}`, { params: chainParam() });
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10000,
  });
}

export function useBlockByNumber(number: string | undefined) {
  return useQuery({
    queryKey: ["block", number],
    enabled: number != null && number !== "",
    queryFn: async (): Promise<Block | null> => {
      const { data } = await api.get(`${env.STRATO_URL}/block`, {
        params: { number, ...chainParam() },
      });
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
  });
}

export function useTransactions(count = 15) {
  return useQuery({
    queryKey: ["transactions", count],
    queryFn: async (): Promise<Transaction[]> => {
      const { data } = await api.get(`${env.STRATO_URL}/transaction/last/${count}`, { params: chainParam() });
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10000,
  });
}

export function useTransactionByHash(hash: string | undefined) {
  return useQuery({
    queryKey: ["transaction", hash],
    enabled: !!hash,
    queryFn: async (): Promise<Transaction | null> => {
      const { data } = await api.get(`${env.STRATO_URL}/transaction`, {
        params: { hash, ...chainParam() },
      });
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
  });
}

export interface AccountMatch {
  commonName: string;
  organization?: string;
  userAddress: string;
}

/** Search the CIRRUS Certificate directory by name / org / address (ilike). */
export async function searchAccounts(term: string): Promise<AccountMatch[]> {
  const q = encodeURIComponent(`*${term}*`);
  const { data } = await api.get(
    `${env.CIRRUS_URL}/Certificate?or=(commonName.ilike.${q},organization.ilike.${q},userAddress.ilike.${q})`
  );
  return Array.isArray(data) ? data : [];
}

export type QueryKind = "block" | "hash" | "address" | "text";

/** Classify a search term to route to the right explorer view. */
export function classifyQuery(term: string): QueryKind {
  const t = term.trim();
  if (/^\d+$/.test(t)) return "block";
  if (/^0x?[0-9a-fA-F]{64}$/.test(t) || /^[0-9a-fA-F]{64}$/.test(t)) return "hash";
  if (/^0x?[0-9a-fA-F]{40}$/.test(t)) return "address";
  return "text";
}
