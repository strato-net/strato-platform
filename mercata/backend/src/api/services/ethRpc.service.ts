/**
 * Minimal JSON-RPC client for the execution-layer Ethereum nodes the
 * bridge-in flow has to talk to. Mirrors the pattern in
 * {@link creditCard.service.ts} (direct axios POSTs to the upstream
 * URL from {@link rpc.config.ts}) but factored into reusable helpers
 * so the trustless bridge code path doesn't duplicate them.
 */
import axios from "axios";

import { getRpcUpstream } from "../../config/rpc.config";

// ─────────────────────────────────────────────────────────────────────
// Eth-RPC JSON shapes (just the fields we touch).
// ─────────────────────────────────────────────────────────────────────

export interface EthLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;       // 0x-prefixed hex
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed?: boolean;
}

export interface EthTransactionReceipt {
  transactionHash: string;
  transactionIndex: string;   // hex
  blockHash: string;
  blockNumber: string;        // hex
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: EthLog[];
  logsBloom: string;
  status: string;             // "0x1" success / "0x0" fail
  type: string;               // EIP-2718 typed-tx envelope type, e.g. "0x2"
  effectiveGasPrice?: string;
}

// ─────────────────────────────────────────────────────────────────────
// JSON-RPC core
// ─────────────────────────────────────────────────────────────────────

interface JsonRpcSuccess<T> { jsonrpc: "2.0"; id: number; result: T }
interface JsonRpcFailure { jsonrpc: "2.0"; id: number; error: { code: number; message: string } }

/**
 * Resolve the JSON-RPC URL for `chainId` and POST a single request,
 * with primary→fallback failover on network/5xx errors.
 */
async function rpcCall<T>(chainId: string, method: string, params: unknown[]): Promise<T> {
  const { upstream, fallback } = getRpcUpstream(chainId);
  if (!upstream && !fallback) {
    throw new Error(`ethRpc: no upstream configured for chainId=${chainId}`);
  }
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const tryUrl = async (url: string) => {
    const res = await axios.post<JsonRpcSuccess<T> | JsonRpcFailure>(url, body, { timeout: 15_000 });
    const data = res.data;
    if ("error" in data && data.error) {
      // Eth-RPC errors are reported in-band as 200s; treat them like a
      // proper failure but don't auto-failover (the next node would
      // probably reject the same call).
      throw new Error(`ethRpc ${method}: ${data.error.message} (code ${data.error.code})`);
    }
    return (data as JsonRpcSuccess<T>).result;
  };

  try {
    if (!upstream) throw new Error("no primary"); // forces fallback
    return await tryUrl(upstream);
  } catch (err: any) {
    const status = err?.response?.status;
    const isClientError = typeof status === "number" && status >= 400 && status < 500;
    if (isClientError || !fallback || fallback === upstream) throw err;
    return await tryUrl(fallback);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public methods
// ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the execution-layer receipt for a transaction. Returns
 * null if the tx isn't mined (yet) — callers in the trustless flow
 * should treat that as "not ready, retry later".
 */
export async function getTransactionReceipt(
  chainId: string,
  txHash: string,
): Promise<EthTransactionReceipt | null> {
  return rpcCall<EthTransactionReceipt | null>(chainId, "eth_getTransactionReceipt", [txHash]);
}

/**
 * Fetch all receipts for a block, in transaction-index order. Used
 * to reconstruct the block's receipts trie when the upstream node
 * doesn't expose a receipts-trie proof endpoint (most don't).
 */
export async function getBlockReceipts(
  chainId: string,
  blockNumberHexOrTag: string,
): Promise<EthTransactionReceipt[]> {
  return rpcCall<EthTransactionReceipt[]>(chainId, "eth_getBlockReceipts", [blockNumberHexOrTag]);
}

/**
 * Block header fields the trustless bridge-in needs for the Base/Cannon
 * path. Mirrors the standard JSON-RPC `eth_getBlockByNumber(_, false)`
 * response — we keep all fields because the backend RLP-encoder needs
 * them to round-trip the header to the same hash the chain committed
 * to. Field presence varies by hard-fork (`withdrawalsRoot` post-Shanghai,
 * `blobGasUsed`/`excessBlobGas`/`parentBeaconBlockRoot` post-Cancun).
 */
export interface EthBlockHeader {
  parentHash: string;
  sha3Uncles: string;
  miner: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  difficulty: string;
  number: string;
  gasLimit: string;
  gasUsed: string;
  timestamp: string;
  extraData: string;
  mixHash: string;
  nonce: string;
  baseFeePerGas?: string;
  hash: string;
  // Post-fork additions:
  withdrawalsRoot?: string;
  blobGasUsed?: string;
  excessBlobGas?: string;
  parentBeaconBlockRoot?: string;
  requestsHash?: string;
}

export async function getBlockByNumber(
  chainId: string,
  blockNumberHex: string,
): Promise<EthBlockHeader> {
  return rpcCall<EthBlockHeader>(chainId, "eth_getBlockByNumber", [blockNumberHex, false]);
}

/** A subset of `eth_getProof` we care about. */
export interface EthGetProofResponse {
  address: string;
  accountProof: string[];
  balance: string;
  codeHash: string;
  nonce: string;
  storageHash: string;
  storageProof: Array<{
    key: string;
    value: string;
    proof: string[];
  }>;
}

/**
 * Fetch an EIP-1186 account+storage proof. We use this to read
 * Base's `L2ToL1MessagePasser.storageHash` (for the OP-Stack
 * outputRoot decomposition) and, more generally, to verify L1
 * state for chains anchored via L1-state proofs.
 */
export async function getProof(
  chainId: string,
  account: string,
  slots: string[],
  blockNumberHex: string,
): Promise<EthGetProofResponse> {
  return rpcCall<EthGetProofResponse>(chainId, "eth_getProof", [account, slots, blockNumberHex]);
}

/**
 * Generic JSON-RPC log query. The bridge-in flow uses it to locate
 * `DisputeGameCreated` events on the L1 DisputeGameFactory.
 */
export interface EthGetLogsFilter {
  address?: string | string[];
  topics?: Array<string | string[] | null>;
  fromBlock?: string;
  toBlock?: string;
}

export async function getLogs(chainId: string, filter: EthGetLogsFilter): Promise<EthLog[]> {
  return rpcCall<EthLog[]>(chainId, "eth_getLogs", [filter]);
}

export async function getBlockNumber(chainId: string): Promise<number> {
  const hex = await rpcCall<string>(chainId, "eth_blockNumber", []);
  return parseInt(hex, 16);
}

/** Subset of `eth_getTransactionByHash` we touch — just the calldata. */
export interface EthTransaction {
  hash: string;
  input: string;          // 0x-prefixed calldata
  to: string | null;
  from: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: string;
}

export async function getTransactionByHash(
  chainId: string,
  txHash: string,
): Promise<EthTransaction | null> {
  return rpcCall<EthTransaction | null>(chainId, "eth_getTransactionByHash", [txHash]);
}
