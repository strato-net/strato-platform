type RpcMapping = Record<string, string | undefined>;

const mainnetChainId = "1";
const sepoliaChainId = "11155111";
const baseChainId = "8453";
const baseSepoliaChainId = "84532";
const lineaChainId = "59144";
const lineaSepoliaChainId = "59141";
const robinhoodChainId = "4663";
const robinhoodTestnetChainId = "46630";

const fallbackRpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET_FALLBACK || "https://eth.merkle.io",
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA_FALLBACK || "https://ethereum-sepolia-rpc.publicnode.com",
  [baseChainId]: process.env.RPC_URL_BASE_FALLBACK || "https://mainnet.base.org",
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA_FALLBACK || "https://sepolia.base.org",
  [lineaChainId]: process.env.RPC_URL_LINEA_FALLBACK || "https://rpc.linea.build",
  [lineaSepoliaChainId]: process.env.RPC_URL_LINEA_SEPOLIA_FALLBACK || "https://rpc.sepolia.linea.build",
  [robinhoodChainId]:
    process.env.RPC_URL_ROBINHOOD_FALLBACK || "https://rpc.mainnet.chain.robinhood.com",
  [robinhoodTestnetChainId]:
    process.env.RPC_URL_ROBINHOOD_TESTNET_FALLBACK ||
    "https://rpc.testnet.chain.robinhood.com",
};

const rpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET || fallbackRpcUpstreams[mainnetChainId],
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA || fallbackRpcUpstreams[sepoliaChainId],
  [baseChainId]: process.env.RPC_URL_BASE || fallbackRpcUpstreams[baseChainId],
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA || fallbackRpcUpstreams[baseSepoliaChainId],
  [lineaChainId]: process.env.RPC_URL_LINEA || fallbackRpcUpstreams[lineaChainId],
  [lineaSepoliaChainId]: process.env.RPC_URL_LINEA_SEPOLIA || fallbackRpcUpstreams[lineaSepoliaChainId],
  [robinhoodChainId]: process.env.RPC_URL_ROBINHOOD || fallbackRpcUpstreams[robinhoodChainId],
  [robinhoodTestnetChainId]:
    process.env.RPC_URL_ROBINHOOD_TESTNET || fallbackRpcUpstreams[robinhoodTestnetChainId],
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
