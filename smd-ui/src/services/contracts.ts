import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { runtime } from "@/lib/env";

export interface XabiFunc {
  name: string;
  args?: Record<string, { type: string; index?: number }>;
  vars?: unknown;
}

export interface ContractXabi {
  xabi?: {
    vars?: Record<string, unknown>;
    funcs?: Record<string, { args?: Record<string, { type: string }> }>;
    types?: Record<string, unknown>;
  };
  address?: string;
  name?: string;
}

const chainParam = () => {
  const id = runtime.chainId();
  return id ? { chainid: id } : {};
};

/** GET /bloc/v2.2/contracts — list of contract names. */
export function useContracts(name: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["contracts", name, limit, offset],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts`, {
        params: { limit, offset, ...(name ? { name } : {}), ...chainParam() },
      });
      return Array.isArray(data) ? data : [];
    },
  });
}

/** GET /bloc/v2.2/contracts/:name — deployed addresses for a contract name. */
export function useContractAddresses(name: string | null) {
  return useQuery({
    queryKey: ["contract-addresses", name],
    enabled: !!name,
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts/${name}`);
      return Array.isArray(data) ? data : [];
    },
  });
}

/** GET /bloc/v2.2/contracts/:name/:address — xabi (vars + funcs). */
export function useContractXabi(name: string | null, address: string | null) {
  return useQuery({
    queryKey: ["contract-xabi", name, address],
    enabled: !!name && !!address,
    queryFn: async (): Promise<ContractXabi> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts/${name}/${address}`);
      return data;
    },
  });
}

/** POST /bloc/v2.2/contracts/compile — compile Solidity source. */
export async function compileContract(contractName: string, source: string, solidvm = true) {
  const { data } = await api.post(`${env.BLOC_URL}/contracts/compile`, [
    { contractName, source, vm: solidvm ? "SolidVM" : "EVM" },
  ]);
  return data;
}

/** GET /cirrus/search/:table?<query> — CIRRUS state query. */
export async function queryCirrus(table: string, queryString: string) {
  const qs = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  const { data } = await api.get(`${env.CIRRUS_URL}/${table}${qs ? `?${qs}` : ""}`);
  return data;
}

async function pollTransactionResult(hash: string, maxAttempts = 30): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data } = await api.get(`${env.STRATO_URL}/transactionResult/${hash}`);
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.status === "Success") return result;
    if (result?.status === "Failure") {
      throw new Error(result.txResult?.message || "Transaction failed");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction polling timed out");
}

type StratoTxType = "CONTRACT" | "FUNCTION" | "TRANSFER";

/**
 * Submit a transaction through the STRATO session (server-side vault signing).
 * Used for the logged-in STRATO wallet. resolve=true returns the resolved result;
 * Pending results are polled to completion.
 */
export async function submitStratoTx(type: StratoTxType, payload: Record<string, unknown>) {
  const { data } = await api.post(
    `${env.STRATO_URL_V23}/transaction`,
    { txs: [{ payload, type }] },
    { params: { resolve: true, ...chainParam() } }
  );
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.status === "Pending" && result?.hash) {
    return pollTransactionResult(result.hash);
  }
  if (result?.status === "Failure") {
    throw new Error(result.txResult?.message || "Transaction failed");
  }
  return result;
}

export function deployContract(contract: string, src: string, args: Record<string, unknown> = {}) {
  return submitStratoTx("CONTRACT", { contract, src, args, metadata: {} });
}

export function callContractMethod(
  contractName: string,
  contractAddress: string,
  method: string,
  args: Record<string, unknown>,
  value: number | string = 0
) {
  return submitStratoTx("FUNCTION", {
    contractName,
    contractAddress,
    value,
    method,
    args,
    metadata: {},
  });
}
