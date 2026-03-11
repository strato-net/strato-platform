type RpcMapping = Record<string, string | undefined>;

const mainnetChainId = "1";
const sepoliaChainId = "11155111";
const baseChainId = "8453";
const baseSepoliaChainId = "84532";
const lineaChainId = "59144";

const fallbackRpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET_FALLBACK || "https://eth.merkle.io",
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA_FALLBACK || "https://sepolia.drpc.org",
  [baseChainId]: process.env.RPC_URL_BASE_FALLBACK || "https://mainnet.base.org",
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA_FALLBACK || "https://sepolia.base.org",
  [lineaChainId]: process.env.RPC_URL_LINEA_FALLBACK || "https://rpc.linea.build",
};

const rpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET || fallbackRpcUpstreams[mainnetChainId],
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA || fallbackRpcUpstreams[sepoliaChainId],
  [baseChainId]: process.env.RPC_URL_BASE || fallbackRpcUpstreams[baseChainId],
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA || fallbackRpcUpstreams[baseSepoliaChainId],
  [lineaChainId]: process.env.RPC_URL_LINEA || fallbackRpcUpstreams[lineaChainId],
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
