import { receiptFingerprint, traceFingerprint, sanitizeRpcError } from "../utils/rpcEvidence";
export { receiptFingerprint, traceFingerprint } from "../utils/rpcEvidence";
import { JsonRpcProvider } from "ethers";
import { fetch } from "../utils/api";
import { getChainRpcUrl, getChainRpcUrls, RPC_BATCH_LIMIT, TRACE_RPC_PROBE_BLOCKS } from "../config";
import type { TransactionTraceResult } from "../types";
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
  return unwrapRpcResult(response, "eth_getLogs", chainId) || [];
};

// Batch get transaction receipts
export const getTransactionReceiptsBatch = async (
  chainId: number,
  txHashes: string[],
): Promise<Map<string, any>> => {
  const providerResults = await Promise.all(
    getChainRpcUrls(chainId).map(async (rpcUrl) => {
      const receipts = new Map<string, any>();
      for (let i = 0; i < txHashes.length; i += RPC_BATCH_LIMIT) {
        const batch = txHashes.slice(i, i + RPC_BATCH_LIMIT);
        const batchRequest = batch.map((txHash, index) => ({
          jsonrpc: "2.0",
          id: index + 1,
          method: "eth_getTransactionReceipt",
          params: [ensureHexPrefix(txHash)],
        }));
        const response: any[] = await fetch.post(rpcUrl, batchRequest);
        if (!Array.isArray(response)) continue;
        response.forEach((item) => {
          const index = Number(item.id) - 1;
          if (item?.result && index >= 0 && index < batch.length) {
            receipts.set(batch[index], item.result);
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
): Promise<Map<string, TransactionTraceResult>> => {
  if (txHashes.length === 0) return new Map();
  const hashes = [...new Set(txHashes)];
  const providers = await Promise.all(getChainRpcUrls(chainId).map(async (url) => {
    const context = `trace_transaction chain=${chainId} provider=${new URL(url).hostname}`;
    const results = new Map<string, TransactionTraceResult>();
    for (let offset = 0; offset < hashes.length; offset += RPC_BATCH_LIMIT) {
      const batch = hashes.slice(offset, offset + RPC_BATCH_LIMIT);
      const requests = batch.map((hash, index) => ({
        jsonrpc: "2.0",
        id: index + 1,
        method: "trace_transaction",
        params: [ensureHexPrefix(hash)],
      }));
      try {
        const response: any = await fetch.post(url, requests);
        if (!Array.isArray(response)) {
          throw new Error(`Invalid trace RPC response${response?.error ? ` code=${Number(response.error.code)} message=${sanitizeRpcError(response.error.message, url)}` : ""}`);
        }
        for (const item of response) {
          const index = Number(item?.id) - 1;
          if (!Number.isInteger(index) || index < 0 || index >= batch.length) continue;
          const hash = batch[index];
          const txContext = `${context} tx=${hash}`;
          if (results.has(hash)) {
            results.set(hash, new Error(`${txContext}: Duplicate trace RPC response`));
          } else if (item.error) {
            results.set(hash, new Error(`${txContext}: Trace RPC failed code=${Number(item.error.code)} message=${sanitizeRpcError(item.error.message, url)}`));
          } else if (!Array.isArray(item.result) || item.result.length === 0) {
            results.set(hash, new Error(`${txContext}: Missing or invalid trace RPC result`));
          } else {
            try {
              traceFingerprint(item.result);
              results.set(hash, item.result);
            } catch {
              results.set(hash, new Error(`${txContext}: Invalid trace RPC evidence`));
            }
          }
        }
        for (const hash of batch) {
          if (!results.has(hash)) results.set(hash, new Error(`${context} tx=${hash}: Missing trace RPC response`));
        }
      } catch (error) {
        for (const hash of batch) {
          results.set(hash, new Error(`${context} tx=${hash}: ${sanitizeRpcError(error, url)}`));
        }
      }
    }
    return results;
  }));
  const result = new Map<string, TransactionTraceResult>();
  for (const hash of hashes) {
    const traces = providers.map((provider) => provider.get(hash)!);
    const error = traces.find((value) => value instanceof Error);
    if (error) {
      result.set(hash, error);
    } else if (traces.some((value) => traceFingerprint(value as any[]) !== traceFingerprint(traces[0] as any[]))) {
      result.set(hash, new Error(`Trace RPC disagreement chain=${chainId} tx=${hash}`));
    } else {
      result.set(hash, traces[0]);
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

export const validateVerificationRpcEndpoints = async (chainId: number): Promise<void> => {
  const urls = getChainRpcUrls(chainId);
  if (new Set(urls.map((url) => new URL(url).hostname)).size < 2) {
    throw new Error("At least two distinct verification RPC hosts are required");
  }
  await Promise.all(urls.map(async (url) => {
    if (new URL(url).protocol !== "https:") throw new Error("Verification RPC must use HTTPS");
    try {
      const result: any = await fetch.post(url, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
      if (result.error || BigInt(result.result) !== BigInt(chainId)) throw new Error("Verification RPC chain ID mismatch");
      let block = unwrapRpcResult(await fetch.post(url, {
        jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false],
      }), "eth_getBlockByNumber", chainId);
      for (let scanned = 0; scanned < TRACE_RPC_PROBE_BLOCKS; scanned++) {
        const hash = block?.transactions?.[0];
        if (typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)) {
          const traces = unwrapRpcResult(await fetch.post(url, {
            jsonrpc: "2.0", id: 1, method: "trace_transaction", params: [hash],
          }), "trace_transaction", chainId);
          if (!Array.isArray(traces) || traces.length === 0) {
            throw new Error("trace_transaction did not return evidence for a mined transaction");
          }
          traceFingerprint(traces);
          return;
        }
        if (!block?.parentHash || scanned + 1 === TRACE_RPC_PROBE_BLOCKS) break;
        block = unwrapRpcResult(await fetch.post(url, {
          jsonrpc: "2.0", id: 1, method: "eth_getBlockByHash", params: [block.parentHash, false],
        }), "eth_getBlockByHash", chainId);
      }
      throw new Error(`Cannot verify trace_transaction support: no transaction in ${TRACE_RPC_PROBE_BLOCKS} recent blocks`);
    } catch (error) {
      throw new Error(`Verification RPC chain=${chainId} provider=${new URL(url).hostname}: ${sanitizeRpcError(error, url)}`);
    }
  }));
};
