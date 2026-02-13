type RpcMapping = Record<string, string | undefined>;

const mainnetChainId = "1";
const sepoliaChainId = "11155111";
const baseChainId = "8453";
const baseSepoliaChainId = "84532";

const fallbackRpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET_FALLBACK || "https://eth.merkle.io",
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA_FALLBACK || "https://sepolia.drpc.org",
  [baseChainId]: process.env.RPC_URL_BASE_FALLBACK || "https://mainnet.base.org",
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA_FALLBACK || "https://sepolia.base.org",
};

const rpcUpstreams: RpcMapping = {
  [mainnetChainId]: process.env.RPC_URL_MAINNET || fallbackRpcUpstreams[mainnetChainId],
  [sepoliaChainId]: process.env.RPC_URL_SEPOLIA || fallbackRpcUpstreams[sepoliaChainId],
  [baseChainId]: process.env.RPC_URL_BASE || fallbackRpcUpstreams[baseChainId],
  [baseSepoliaChainId]: process.env.RPC_URL_BASE_SEPOLIA || fallbackRpcUpstreams[baseSepoliaChainId],
};

export function getRpcUpstream(chainId: string): {upstream: string | undefined, fallback: string | undefined} {
  return {upstream: rpcUpstreams[chainId], fallback: fallbackRpcUpstreams[chainId]};
}
