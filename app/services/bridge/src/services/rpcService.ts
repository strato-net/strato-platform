import { fetch } from "../utils/api";
import { getChainRpcUrl } from "../config";
import { ensureHexPrefix, decimalToHex } from "../utils/utils";

// HyperEVM caps JSON-RPC batches at 20 calls per HTTP request
const RPC_BATCH_LIMIT = 20;

// JSON-RPC errors arrive with HTTP 200 — never coerce one into an empty result
const unwrapRpcResult = (response: any, method: string, chainId: number): any => {
  if (!response || response.error || !("result" in response)) {
    throw new Error(
      `${method} failed on chain ${chainId}: ${JSON.stringify(response?.error ?? response ?? null)}`,
    );
  }
  return response.result;
};

// Get current block number for a chain
export const getCurrentBlockNumber = async (
  chainId: number,
): Promise<number> => {
  const rpcUrl = getChainRpcUrl(chainId);
  const response: any = await fetch.post(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_blockNumber",
    params: [],
  });
  return parseInt(unwrapRpcResult(response, "eth_blockNumber", chainId) || "0", 16);
};

// Whether this RPC endpoint can serve the given block yet (a lagging backend returns null)
export const hasBlock = async (
  chainId: number,
  blockNumber: number,
): Promise<boolean> => {
  const rpcUrl = getChainRpcUrl(chainId);
  const response: any = await fetch.post(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getBlockByNumber",
    params: [decimalToHex(blockNumber.toString()), false],
  });
  return unwrapRpcResult(response, "eth_getBlockByNumber", chainId) != null;
};

// Get logs for a specific chain
export const getChainLogs = async (
  chainId: number,
  fromBlock: number,
  toBlock: number,
  depositRouter: string,
  eventSignatures: string | string[],
): Promise<any[]> => {
  const rpcUrl = getChainRpcUrl(chainId);

  // Ensure depositRouter has 0x prefix
  const formattedAddress = ensureHexPrefix(depositRouter);

  const response: any = await fetch.post(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [
      {
        fromBlock: decimalToHex(fromBlock.toString()),
        toBlock: decimalToHex(toBlock.toString()),
        topics: [eventSignatures],
        address: formattedAddress,
      },
    ],
  });
  return unwrapRpcResult(response, "eth_getLogs", chainId) || [];
};

const normalizeTxHash = (txHash: string): string =>
  ensureHexPrefix(txHash).toLowerCase();

// Batch get transaction receipts
export const getTransactionReceiptsBatch = async (
  chainId: number,
  txHashes: string[],
): Promise<Map<string, any>> => {
  const rpcUrl = getChainRpcUrl(chainId);
  const result = new Map<string, any>();

  // Split into requests the node will accept
  for (let i = 0; i < txHashes.length; i += RPC_BATCH_LIMIT) {
    const batch = txHashes.slice(i, i + RPC_BATCH_LIMIT);
    const idToTxHash = new Map<number, string>();

    // Create batch request
    const batchRequest = batch.map((txHash, index) => {
      const id = index + 1;
      idToTxHash.set(id, txHash);
      return {
        jsonrpc: "2.0",
        id,
        method: "eth_getTransactionReceipt",
        params: [ensureHexPrefix(txHash)],
      };
    });

    const response: any[] = await fetch.post(rpcUrl, batchRequest);

    // Map responses back to tx hashes by JSON-RPC id and verify returned tx hash
    if (Array.isArray(response)) {
      for (const item of response) {
        if (!item || item.error || !item.result) continue;
        const txHash = idToTxHash.get(item.id);
        if (!txHash) continue;
        if (
          typeof item.result.transactionHash !== "string" ||
          normalizeTxHash(item.result.transactionHash) !== normalizeTxHash(txHash)
        ) {
          continue;
        }
        result.set(txHash, item.result);
        idToTxHash.delete(item.id);
      }
    }
  }

  return result;
};

// Batch get internal transactions
export const getInternalTransactionsBatch = async (
  chainId: number,
  txHashes: string[],
): Promise<Map<string, any[]>> => {
  const rpcUrl = getChainRpcUrl(chainId);
  const result = new Map<string, any[]>();

  // Split into requests the node will accept
  for (let i = 0; i < txHashes.length; i += RPC_BATCH_LIMIT) {
    const batch = txHashes.slice(i, i + RPC_BATCH_LIMIT);
    const idToTxHash = new Map<number, string>();

    // Create batch request
    const batchRequest = batch.map((txHash, index) => {
      const id = index + 1;
      idToTxHash.set(id, txHash);
      return {
        jsonrpc: "2.0",
        id,
        method: "trace_transaction",
        params: [ensureHexPrefix(txHash)],
      };
    });

    const response: any[] = await fetch.post(rpcUrl, batchRequest);

    // Map responses back to tx hashes by JSON-RPC id and verify returned tx hashes
    if (Array.isArray(response)) {
      for (const item of response) {
        if (!item || item.error || !Array.isArray(item.result)) continue;
        const txHash = idToTxHash.get(item.id);
        if (!txHash) continue;
        const expectedHash = normalizeTxHash(txHash);
        const allMatch = item.result.every(
          (trace: any) =>
            typeof trace?.transactionHash === "string" &&
            normalizeTxHash(trace.transactionHash) === expectedHash,
        );
        if (!allMatch) continue;
        result.set(txHash, item.result);
        idToTxHash.delete(item.id);
      }
    }
  }

  return result;
};

// Check if chain RPC is configured
export const isChainConfigured = (chainId: number): boolean => {
  try {
    getChainRpcUrl(chainId);
    return true;
  } catch {
    return false;
  }
};
