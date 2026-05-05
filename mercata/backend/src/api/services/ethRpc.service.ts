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
