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
  /** the block's hash — top-level `blockHash` (not `hash`); used by /block?hash= */
  blockHash?: string;
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

/**
 * strato-api hash/address query params reject a leading `0x` (400 Bad Request),
 * and stored hex values are kept without it — strip it before querying/searching.
 */
export function stripHexPrefix(s: string): string {
  return s.replace(/^0x/i, "");
}

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

/** GET /block?hash=<hash> — block by its hash (0x prefix stripped). */
export function useBlockByHash(hash: string | undefined) {
  const h = hash ? stripHexPrefix(hash) : hash;
  return useQuery({
    queryKey: ["block-by-hash", h],
    enabled: !!h,
    queryFn: async (): Promise<Block | null> => {
      const { data } = await api.get(`${env.STRATO_URL}/block`, {
        params: { hash: h, ...chainParam() },
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
  const h = hash ? stripHexPrefix(hash) : hash;
  return useQuery({
    queryKey: ["transaction", h],
    enabled: !!h,
    queryFn: async (): Promise<Transaction | null> => {
      const { data } = await api.get(`${env.STRATO_URL}/transaction`, {
        params: { hash: h, ...chainParam() },
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

export interface AccountEntry {
  address: string;
  balance?: string | number;
  contractName?: string | null;
  nonce?: number | string;
  codeHash?: string;
}

export interface StorageEntry {
  address: string;
  key?: string;
  value?: string;
}

/**
 * General full-text search via strato-api's `search` query param, which matches
 * a `%term%` pattern. Available on the transaction, account, and storage endpoints.
 */
export async function searchTransactions(term: string): Promise<Transaction[]> {
  const { data } = await api.get(`${env.STRATO_URL}/transaction`, {
    params: { search: term, ...chainParam() },
  });
  return Array.isArray(data) ? data : [];
}

export async function searchStratoAccounts(term: string): Promise<AccountEntry[]> {
  const { data } = await api.get(`${env.STRATO_URL}/account`, {
    params: { search: term, ...chainParam() },
  });
  return Array.isArray(data) ? data : [];
}

export async function searchStorage(term: string): Promise<StorageEntry[]> {
  const { data } = await api.get(`${env.STRATO_URL}/storage`, {
    params: { search: term, ...chainParam() },
  });
  return Array.isArray(data) ? data : [];
}

/** GET /block?search=<term> — matches block hash / coinbase (%term%). */
export async function searchBlocks(term: string): Promise<Block[]> {
  const { data } = await api.get(`${env.STRATO_URL}/block`, {
    params: { search: term, ...chainParam() },
  });
  return Array.isArray(data) ? data : [];
}

/** GET /storage?address=<addr> — all storage entries for an address (0x stripped). */
export function useStorageByAddress(address?: string) {
  const a = address ? stripHexPrefix(address) : address;
  return useQuery({
    queryKey: ["storage-by-address", a],
    enabled: !!a,
    queryFn: async (): Promise<StorageEntry[]> => {
      const { data } = await api.get(`${env.STRATO_URL}/storage`, {
        params: { address: a, ...chainParam() },
      });
      return Array.isArray(data) ? data : [];
    },
  });
}

/** GET /transaction?address=<addr> — transactions involving an address (0x stripped). */
export function useTransactionsByAddress(address?: string) {
  const a = address ? stripHexPrefix(address) : address;
  return useQuery({
    queryKey: ["txns-by-address", a],
    enabled: !!a,
    queryFn: async (): Promise<Transaction[]> => {
      const { data } = await api.get(`${env.STRATO_URL}/transaction`, {
        params: { address: a, ...chainParam() },
      });
      return Array.isArray(data) ? data : [];
    },
  });
}

export type QueryKind = "block" | "hash" | "address" | "text";

/** Classify a search term to route to the right explorer view. */
export function classifyQuery(term: string): QueryKind {
  const t = term.trim();
  const hex = stripHexPrefix(t);
  if (/^\d+$/.test(t) && t.length < 40) return "block";
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return "hash";
  if (/^[0-9a-fA-F]{40}$/.test(hex)) return "address";
  return "text";
}
