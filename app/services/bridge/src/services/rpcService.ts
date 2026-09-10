import { fetch } from "../utils/api";
import { getChainRpcUrl, getChainRpcUrls } from "../config";
import { ensureHexPrefix, decimalToHex } from "../utils/utils";

const normalizeHex = (value: unknown): unknown =>
  typeof value === "string" && value.toLowerCase().startsWith("0x")
    ? value.toLowerCase()
    : value;

export const receiptFingerprint = (receipt: any): string =>
  JSON.stringify({
    transactionHash: normalizeHex(receipt?.transactionHash),
    blockHash: normalizeHex(receipt?.blockHash),
    blockNumber: normalizeHex(receipt?.blockNumber),
    status: normalizeHex(receipt?.status),
    to: normalizeHex(receipt?.to),
    logs: (receipt?.logs || []).map((log: any) => ({
      address: normalizeHex(log.address),
      topics: (log.topics || []).map(normalizeHex),
      data: normalizeHex(log.data),
      logIndex: normalizeHex(log.logIndex),
    })),
  });

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
  return parseInt(response?.result || "0", 16);
};

export const getBlockTimestamp = async (
  chainId: number,
  blockNumber: number,
): Promise<number> => {
  const response: any = await fetch.post(getChainRpcUrl(chainId), {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getBlockByNumber",
    params: [decimalToHex(blockNumber.toString()), false],
  });
  if (!response?.result?.timestamp) {
    throw new Error(`Block ${blockNumber} not found on chain ${chainId}`);
  }
  return Number(BigInt(response.result.timestamp)) * 1000;
};

// Get logs for a specific chain
export const getChainLogs = async (
  chainId: number,
  fromBlock: number,
  toBlock: number,
  depositRouter: string | string[],
  eventSignatures: string | string[],
): Promise<any[]> => {
  const rpcUrl = getChainRpcUrl(chainId);

  // Ensure depositRouter has 0x prefix
  const formattedAddress = Array.isArray(depositRouter)
    ? depositRouter.map(ensureHexPrefix)
    : ensureHexPrefix(depositRouter);

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
  return response?.result || [];
};

// Batch get transaction receipts
export const getTransactionReceiptsBatch = async (
  chainId: number,
  txHashes: string[],
): Promise<Map<string, any>> => {
  const batchRequest = txHashes.map((txHash, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_getTransactionReceipt",
    params: [ensureHexPrefix(txHash)],
  }));

  const providerResults = await Promise.all(
    getChainRpcUrls(chainId).map(async (rpcUrl) => {
      const response: any[] = await fetch.post(rpcUrl, batchRequest);
      const receipts = new Map<string, any>();
      if (Array.isArray(response)) {
        response.forEach((item) => {
          const index = Number(item.id) - 1;
          if (item?.result && index >= 0 && index < txHashes.length) {
            receipts.set(txHashes[index], item.result);
          }
        });
      }
      return receipts;
    }),
  );

  const result = new Map<string, any>();
  for (const txHash of txHashes) {
    const receipts = providerResults.map((provider) => provider.get(txHash));
    const first = receipts[0];
    const allPresent = receipts.every(Boolean);
    if (first && allPresent && receipts.every(
      (receipt) => receiptFingerprint(receipt) === receiptFingerprint(first),
    )) {
      result.set(txHash, first);
    } else if (first && allPresent) {
      result.set(txHash, { ...first, __rpcDisagreement: true });
    }
  }
  return result;
};

// Batch get internal transactions
export const getInternalTransactionsBatch = async (
  chainId: number,
  txHashes: string[],
): Promise<Map<string, any[]>> => {
  const batchRequest = txHashes.map((txHash, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "trace_transaction",
    params: [ensureHexPrefix(txHash)],
  }));

  const response: any[] = await fetch.post(getChainRpcUrl(chainId), batchRequest);
  const result = new Map<string, any[]>();
  if (Array.isArray(response)) {
    response.forEach((item) => {
      const index = Number(item.id) - 1;
      if (item?.result && index >= 0 && index < txHashes.length) {
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
