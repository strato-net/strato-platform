type RpcMapping = Record<string, string | undefined>;

const mainnetChainId = "1";
const sepoliaChainId = "11155111";
const baseChainId = "8453";
const baseSepoliaChainId = "84532";
const lineaChainId = "59144";
const lineaSepoliaChainId = "59141";

const fallbackRpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET_FALLBACK || "https://eth.merkle.io",
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA_FALLBACK || "https://sepolia.drpc.org",
  [baseChainId]: process.env.RPC_URL_BASE_FALLBACK || "https://mainnet.base.org",
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA_FALLBACK || "https://sepolia.base.org",
  [lineaChainId]: process.env.RPC_URL_LINEA_FALLBACK || "https://rpc.linea.build",
  [lineaSepoliaChainId]: process.env.RPC_URL_LINEA_SEPOLIA_FALLBACK || "https://rpc.sepolia.linea.build",
};

const rpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET || fallbackRpcUpstreams[mainnetChainId],
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA || fallbackRpcUpstreams[sepoliaChainId],
  [baseChainId]: process.env.RPC_URL_BASE || fallbackRpcUpstreams[baseChainId],
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA || fallbackRpcUpstreams[baseSepoliaChainId],
  [lineaChainId]: process.env.RPC_URL_LINEA || fallbackRpcUpstreams[lineaChainId],
  [lineaSepoliaChainId]: process.env.RPC_URL_LINEA_SEPOLIA || fallbackRpcUpstreams[lineaSepoliaChainId],
};

export function getRpcUpstream(chainId: string): { upstream: string | undefined; fallback: string | undefined } {
  // STRATO/Cirrus chain: use node URL + JSON-RPC path (set at runtime after initNetworkConfig)
  const { nodeUrl, networkId } = require("./config");
  if (networkId && String(chainId) === String(networkId)) {
    const base = (nodeUrl || "").replace(/\/$/, "");
    const url = base ? `${base}/strato-api/eth/v1.2` : undefined;
    return url ? { upstream: url, fallback: url } : { upstream: undefined, fallback: undefined };
  }
  return { upstream: rpcUpstreams[chainId], fallback: fallbackRpcUpstreams[chainId] };
}

// ─────────────────────────────────────────────────────────────────────
// Beacon-API endpoints — used by the trustless bridge-in's
// LightClientFinalityUpdate / sync-committee fetcher. Only Ethereum-
// flavoured chains have a beacon API; the rest are mapped to undefined.
// ─────────────────────────────────────────────────────────────────────

const fallbackBeaconUpstreams: RpcMapping = {
  // Public Sepolia beacon node (no auth, generous rate limits as of 2026).
  [sepoliaChainId]: process.env.BEACON_URL_SEPOLIA_FALLBACK || "https://lodestar-sepolia.chainsafe.io",
  // No reliable free public mainnet beacon endpoint; treat as required env.
  [mainnetChainId]: process.env.BEACON_URL_MAINNET_FALLBACK,
};

const beaconUpstreams: RpcMapping = {
  [sepoliaChainId]: process.env.BEACON_URL_SEPOLIA || fallbackBeaconUpstreams[sepoliaChainId],
  [mainnetChainId]: process.env.BEACON_URL_MAINNET || fallbackBeaconUpstreams[mainnetChainId],
};

/**
 * Returns the beacon-API URL pair for an Ethereum-flavoured source
 * chain. Non-Ethereum chains (Base, Linea, etc.) return undefined —
 * they don't have a beacon chain. The trustless bridge-in path only
 * makes sense for Ethereum-flavoured deposits; callers should fall
 * back to relayer-attested confirmation otherwise.
 */
export function getBeaconUpstream(chainId: string): { upstream: string | undefined; fallback: string | undefined } {
  return { upstream: beaconUpstreams[chainId], fallback: fallbackBeaconUpstreams[chainId] };
}
