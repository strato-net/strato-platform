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

/** Max attempts per JSON-RPC call (across primary+fallback). 429/5xx
 *  are common on free public endpoints; without backoff a single
 *  rate-limit hit cascades into a hard failure of the whole flow. */
const ETHRPC_MAX_ATTEMPTS: number = (() => {
  const raw = process.env.ETHRPC_MAX_ATTEMPTS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 4;
})();

function isRetryableHttpStatus(s: number | undefined): boolean {
  if (s === undefined) return true; // network error / timeout
  return s === 429 || (s >= 500 && s <= 599);
}

async function rpcBackoff(err: any, attempt: number): Promise<void> {
  const retryAfter = err?.response?.headers?.["retry-after"];
  let ms: number | undefined;
  if (typeof retryAfter === "string") {
    const asInt = parseInt(retryAfter, 10);
    if (Number.isFinite(asInt)) ms = asInt * 1000;
    else {
      const asDate = Date.parse(retryAfter);
      if (Number.isFinite(asDate)) ms = Math.max(0, asDate - Date.now());
    }
  }
  if (ms === undefined) {
    const base = Math.min(2000, 250 * 2 ** attempt);
    ms = base * (0.8 + Math.random() * 0.4);
  }
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve the JSON-RPC URL for `chainId` and POST a single request,
 * with primary→fallback failover plus 429/5xx exponential-backoff
 * retry. In-band JSON-RPC errors (200s carrying `data.error`) are
 * NOT retried — those are deterministic failures of the call itself.
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
      throw new Error(`ethRpc ${method}: ${data.error.message} (code ${data.error.code})`);
    }
    return (data as JsonRpcSuccess<T>).result;
  };

  let lastErr: any;
  for (let attempt = 0; attempt < ETHRPC_MAX_ATTEMPTS; attempt++) {
    // Even attempts → primary; odd → fallback (if available). When
    // there's only one URL, it's used every attempt with backoff.
    const url =
      attempt % 2 === 0 || !fallback || fallback === upstream
        ? upstream
        : fallback;
    if (!url) {
      // Fallback unavailable on an odd attempt — shift back to primary.
      if (!upstream) throw lastErr ?? new Error("no upstream available");
      try { return await tryUrl(upstream); }
      catch (err: any) { lastErr = err; continue; }
    }
    try {
      return await tryUrl(url);
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      // In-band JSON-RPC errors aren't HTTP-level → no `response.status`;
      // those are deterministic and shouldn't be retried.
      const isInBandRpcError =
        typeof err?.message === "string" && err.message.startsWith(`ethRpc ${method}:`);
      if (isInBandRpcError) throw err;
      if (!isRetryableHttpStatus(status)) throw err;
      if (attempt === ETHRPC_MAX_ATTEMPTS - 1) break;
      const reason = status ?? "network";
      console.warn(`[EthRpc] ${reason} on ${method} (attempt ${attempt + 1}/${ETHRPC_MAX_ATTEMPTS}); backing off`);
      await rpcBackoff(err, attempt);
    }
  }
  throw lastErr;
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
