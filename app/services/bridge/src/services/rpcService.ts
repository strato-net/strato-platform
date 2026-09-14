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

    // Create batch request
    const batchRequest = batch.map((txHash, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "eth_getTransactionReceipt",
      params: [ensureHexPrefix(txHash)],
    }));

    const response: any[] = await fetch.post(rpcUrl, batchRequest);

    // Map responses back to tx hashes
    if (Array.isArray(response)) {
      response.forEach((item, index) => {
        if (item?.result) {
          result.set(batch[index], item.result);
        }
      });
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
  
  // Create batch request
  const batchRequest = txHashes.map((txHash, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "trace_transaction",
    params: [ensureHexPrefix(txHash)],
  }));

  const response: any[] = await fetch.post(rpcUrl, batchRequest);
  
  // Map responses back to tx hashes
  const result = new Map<string, any[]>();
  if (Array.isArray(response)) {
    response.forEach((item, index) => {
      if (item?.result) {
        result.set(txHashes[index], item.result || []);
      }
    });
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
