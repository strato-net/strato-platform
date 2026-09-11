import { receiptFingerprint, traceFingerprint } from "../utils/rpcEvidence";
export { receiptFingerprint, traceFingerprint } from "../utils/rpcEvidence";
import { JsonRpcProvider } from "ethers";
import { fetch } from "../utils/api";
import { getChainRpcUrl, getChainRpcUrls } from "../config";
import { ensureHexPrefix, decimalToHex } from "../utils/utils";

const chainProviders = new Map<string, JsonRpcProvider>();

export const getChainProvider = (chainId: number | bigint | string): JsonRpcProvider => {
  const url = getChainRpcUrl(BigInt(chainId));
  const key = `${BigInt(chainId)}:${url}`;
  let provider = chainProviders.get(key);
  if (!provider) {
    provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
    chainProviders.set(key, provider);
  }
  return provider;
};

export const closeChainProviders = (): void => {
  for (const provider of chainProviders.values()) provider.destroy();
  chainProviders.clear();
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
  if (txHashes.length === 0) return new Map();
  const batchRequest = txHashes.map((txHash, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "trace_transaction",
    params: [ensureHexPrefix(txHash)],
  }));

  const providers = await Promise.all(getChainRpcUrls(chainId).map(async (url) => {
    const response: any[] = await fetch.post(url, batchRequest);
    if (!Array.isArray(response)) throw new Error("Invalid trace RPC response");
    const results = new Map<string, any[]>();
    for (const item of response) {
      const index = Number(item.id) - 1;
      if (item.error || !Array.isArray(item.result) || index < 0 || index >= txHashes.length || results.has(txHashes[index])) {
        throw new Error("Missing, duplicate or failed trace RPC response");
      }
      results.set(txHashes[index], item.result);
    }
    return results;
  }));
  const result = new Map<string, any[]>();
  for (const hash of txHashes) {
    const traces = providers.map((provider) => provider.get(hash));
    if (traces.some((value) => !value)) throw new Error("Missing trace RPC response");
    if (traces.some((value) => traceFingerprint(value!) !== traceFingerprint(traces[0]!))) {
      throw new Error("Trace RPC disagreement");
    }
    result.set(hash, traces[0]!);
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

export const validateVerificationRpcEndpoints = async (chainId: number): Promise<void> => {
  const urls = getChainRpcUrls(chainId);
  if (new Set(urls.map((url) => new URL(url).hostname)).size < 2) {
    throw new Error("At least two distinct verification RPC hosts are required");
  }
  await Promise.all(urls.map(async (url) => {
    if (new URL(url).protocol !== "https:") throw new Error("Verification RPC must use HTTPS");
    const result: any = await fetch.post(url, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    if (result.error || BigInt(result.result) !== BigInt(chainId)) throw new Error("Verification RPC chain ID mismatch");
  }));
};
