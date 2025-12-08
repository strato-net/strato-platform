type RpcMapping = Record<string, string | undefined>;

const mainnetChainId = "1";
const sepoliaChainId = "11155111";

const fallbackRpcUpstreams: RpcMapping = {
  mainnetChainId: process.env.RPC_URL_MAINNET_FALLBACK || "https://eth.merkle.io",
  sepoliaChainId: process.env.RPC_URL_SEPOLIA_FALLBACK || "https://sepolia.drpc.org",
};

const rpcUpstreams: RpcMapping = {
  mainnetChainId: process.env.RPC_URL_MAINNET || fallbackRpcUpstreams[mainnetChainId],
  sepoliaChainId: process.env.RPC_URL_SEPOLIA || fallbackRpcUpstreams[sepoliaChainId],
};

export function getRpcUpstream(chainId: string): {upstream: string | undefined, fallback: string | undefined} {
  return {upstream: rpcUpstreams[chainId], fallback: fallbackRpcUpstreams[chainId]};
}
