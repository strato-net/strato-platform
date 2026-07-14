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

/**
 * GET /bloc/v2.2/contracts — bloc returns an OBJECT keyed by contract name
 * ({ Name: { instances: [...] } }); older shapes may return an array of names.
 * Returns a sorted list of names either way.
 */
export function useContracts(name: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["contracts", name, limit, offset],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts`, {
        params: { limit, offset, ...(name ? { name } : {}), ...chainParam() },
      });
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object") return Object.keys(data).sort();
      return [];
    },
  });
}

export interface ContractGroup {
  name: string;
  addresses: string[];
}

/**
 * GET /bloc/v2.2/contracts?name=<search> — map of contract name -> instances.
 * The `name` param matches a substring of BOTH contract names and instance
 * addresses, so searching "1008" returns contracts whose instance addresses
 * contain "1008". Response shape: { Name: [{ address, createdAt }, ...] }.
 */
export function useContractGroups(search: string, limit = 10, offset = 0) {
  return useQuery({
    queryKey: ["contract-groups", search, limit, offset],
    queryFn: async (): Promise<ContractGroup[]> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts`, {
        params: { limit, offset, ...(search ? { name: search } : {}), ...chainParam() },
      });
      if (!data || typeof data !== "object") return [];
      return Object.entries(data as Record<string, any>).map(([name, insts]) => {
        const list = Array.isArray(insts) ? insts : insts?.instances ?? [];
        return {
          name,
          addresses: (list as any[])
            .map((i) => (typeof i === "string" ? i : i?.address))
            .filter(Boolean),
        };
      });
    },
  });
}

/** GET /bloc/v2.2/contracts/:name/:address/state — symbol -> value (state vars + function signatures). */
export function useContractState(name: string | null, address: string | null) {
  return useQuery({
    queryKey: ["contract-state", name, address],
    enabled: !!name && !!address,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts/${name}/${address}/state`, {
        params: chainParam(),
      });
      return data && typeof data === "object" ? data : {};
    },
  });
}

export interface FuncArg {
  name: string;
  type: string;
}
export interface ContractFunction {
  name: string;
  args: FuncArg[];
  payable: boolean;
  signature: string;
}

/**
 * Render a bloc xabi type descriptor (SolidVM Type JSON, e.g.
 * { tag: "Int", signed: true, bytes: 32 }) as a Solidity type name like
 * "uint256". Used both as the input placeholder and as the {"type","value"}
 * hint bloc uses to disambiguate argument parsing.
 */
export function solidityTypeName(t: any): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  switch (t.tag) {
    case "Int":
      return `${t.signed ? "" : "u"}int${t.bytes ? t.bytes * 8 : ""}`;
    case "String":
      return "string";
    case "Bytes":
      return t.bytes ? `bytes${t.bytes}` : "bytes";
    case "Decimal":
      return "decimal";
    case "Bool":
      return "bool";
    case "Address":
      return "address";
    case "Account":
      return "account";
    case "UnknownLabel":
      return typeof t.contents === "string" ? t.contents : "";
    case "Struct":
    case "Enum":
    case "Error":
    case "Contract":
      return t.typedef ?? "";
    case "UserDefined":
      return solidityTypeName(t.actual);
    case "Array": {
      const inner = solidityTypeName(t.entry ?? t.type);
      return inner ? `${inner}[${t.length ?? ""}]` : "";
    }
    default:
      return t.tag ?? "";
  }
}

function argType(def: any): string {
  return solidityTypeName(def?.type);
}

/** GET /bloc/v2.2/contracts/:name/:address — full contract info (function arg names/types live here). */
export function useContractInfo(name: string | null, address: string | null) {
  return useQuery({
    queryKey: ["contract-info", name, address],
    enabled: !!name && !!address,
    queryFn: async (): Promise<any> => {
      const { data } = await api.get(`${env.BLOC_URL}/contracts/${name}/${address}`, {
        params: chainParam(),
      });
      return data;
    },
  });
}

/** A state value that is a function signature, e.g. `function (uint256,string) returns ()`. */
export function isFunctionValue(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("function");
}

/** Extract a function's argument list (name + type tag) from the contract info. */
export function functionArgs(info: any, fnName: string): FuncArg[] {
  const args = info?._functions?.[fnName]?._funcArgs;
  if (!Array.isArray(args)) return [];
  // _funcArgs is an array of [name, { type: { tag } }] tuples.
  return args.map((entry: any) => ({ name: entry?.[0] ?? "", type: argType(entry?.[1]) }));
}

/** Whether a function is payable (accepts value), from its state mutability. */
export function isPayable(info: any, fnName: string): boolean {
  return info?._functions?.[fnName]?._funcStateMutability === "payable";
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

export interface ConstructorArg {
  name: string;
  type: string;
  index?: number;
}

export interface XabiContract {
  /** constructor args, keyed by name */
  constr?: { args?: Record<string, { type: string; index?: number }> };
  [key: string]: unknown;
}

export interface XabiResult {
  /** map of contract name -> contract xabi (incl. constructor args) */
  src?: Record<string, XabiContract>;
  [key: string]: unknown;
}

/**
 * POST /bloc/v2.2/contracts/xabi — tokenize/parse source into its xabi.
 * Returns `{ src: { ContractName: { constr: { args } }, ... } }`; used by the
 * editor to list the contracts in the source and their constructor arguments.
 */
export async function tokenizeSource(source: string): Promise<XabiResult> {
  const { data } = await api.post(`${env.BLOC_URL}/contracts/xabi`, { src: source });
  return data;
}

/** Extract a contract's constructor args (ordered by `index` when present). */
export function constructorArgs(xabi: XabiResult | null, contractName: string): ConstructorArg[] {
  const contract = xabi?.src?.[contractName];
  const args = contract?.constr?.args;
  if (!args) return [];
  return Object.entries(args)
    .map(([name, def]) => ({ name, type: def.type, index: def.index }))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** GET /cirrus/search/:table?<query> — Cirrus state query. */
export async function queryCirrus(table: string, queryString: string) {
  const qs = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  const { data } = await api.get(`${env.CIRRUS_URL}/${table}${qs ? `?${qs}` : ""}`);
  return data;
}

async function pollTransactionResult(hash: string, maxAttempts = 30): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data } = await api.get(`${env.STRATO_URL}/transactionResult/${hash}`, {
      skipErrorToast: true,
    });
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
export async function submitStratoTx(
  type: StratoTxType,
  payload: Record<string, unknown>,
  username?: string
) {
  const { data } = await api.post(
    `${env.STRATO_URL_V23}/transaction`,
    { txs: [{ payload, type }] },
    // `username` routes the tx through the user's User wallet contract (server-side
    // vault signing); the node wraps CONTRACT/FUNCTION as createContract/callContract.
    // Callers surface tx failures themselves, so skip the global error toast.
    {
      params: { resolve: true, ...chainParam(), ...(username ? { username } : {}) },
      skipErrorToast: true,
    }
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
