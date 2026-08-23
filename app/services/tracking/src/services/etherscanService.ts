import axios from "axios";
import { config } from "../config";
import { logError } from "../utils/logger";
import { externalChain } from "../utils/chains";

// Optional remote-chain enrichment for the user timeline: the origin-chain
// transactions that led up to a bridge-in ("how did this user arrive?").
// Etherscan's V2 API is multichain (one key, `chainid` selects the network)
// and every scan family that mirrors it (Basescan, Polygonscan, …) answers the
// same shape, so a single key covers all bridge origins. Disabled — silently,
// the timeline just omits these items — when no API key is configured.

export interface RemoteChainTx {
  chainId: number;
  hash: string;
  from: string;
  to: string | null;
  value: string; // raw wei string
  timestampMs: number;
  functionName: string | null;
  failed: boolean;
}

export const remoteChainEnabled = (): boolean => Boolean(config.etherscan.apiKey);

// Free Etherscan plans are rate limited (5 req/s), and a dashboard user
// reloading a timeline must not burn the quota: cache per chain+address.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { txs: RemoteChainTx[]; expiresAt: number }>();

const hexAddress = (address: string): string =>
  address.startsWith("0x") ? address : `0x${address}`;

const parseTx = (chainId: number, row: any): RemoteChainTx | null => {
  if (!row?.hash) return null;
  const seconds = Number(row.timeStamp);
  if (!Number.isFinite(seconds)) return null;
  return {
    chainId,
    hash: String(row.hash),
    from: String(row.from ?? "").toLowerCase(),
    to: row.to ? String(row.to).toLowerCase() : null,
    value: String(row.value ?? "0"),
    timestampMs: seconds * 1000,
    // Etherscan sends "" for plain transfers and "transfer(address,uint256)"
    // style signatures for contract calls
    functionName: row.functionName ? String(row.functionName) : null,
    failed: String(row.isError ?? "0") === "1",
  };
};

// Most recent transactions of `address` on `chainId`, newest first. Never
// throws: enrichment is best-effort, the rest of the timeline still renders.
export const fetchRemoteChainTxs = async (
  chainId: number,
  address: string
): Promise<RemoteChainTx[]> => {
  if (!remoteChainEnabled() || !externalChain(chainId)) return [];
  const cacheKey = `${chainId}:${address}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.txs;

  let txs: RemoteChainTx[] = [];
  try {
    const { data } = await axios.get(config.etherscan.apiUrl, {
      timeout: 15000,
      params: {
        chainid: chainId,
        module: "account",
        action: "txlist",
        address: hexAddress(address),
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: config.etherscan.maxTransactions,
        sort: "desc",
        apikey: config.etherscan.apiKey,
      },
    });
    // status "0" means "no transactions found" or an error; result is then a
    // string message rather than an array
    const rows = Array.isArray(data?.result) ? data.result : [];
    txs = rows
      .map((row: any) => parseTx(chainId, row))
      .filter((tx: RemoteChainTx | null): tx is RemoteChainTx => tx !== null)
      .slice(0, config.etherscan.maxTransactions);
  } catch (error) {
    logError("Etherscan", error, { operation: "fetchRemoteChainTxs", chainId });
    return [];
  }
  cache.set(cacheKey, { txs, expiresAt: Date.now() + CACHE_TTL_MS });
  return txs;
};
