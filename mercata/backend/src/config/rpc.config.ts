type RpcMapping = Record<string, string | undefined>;

const fallbackRpcUpstreams: RpcMapping = {
  // Ethereum mainnet
  "1": process.env.RPC_URL_MAINNET_FALLBACK || "https://eth.merkle.io",
  // Sepolia
  "11155111": process.env.RPC_URL_SEPOLIA_FALLBACK || "https://sepolia.drpc.org",
  // Polygon
  "137": process.env.RPC_URL_POLYGON_FALLBACK || "https://polygon-rpc.com",
};

const rpcUpstreams: RpcMapping = {
  // Ethereum mainnet
  "1": process.env.RPC_URL_MAINNET || fallbackRpcUpstreams["1"],
  // Sepolia
  "11155111": process.env.RPC_URL_SEPOLIA || fallbackRpcUpstreams["11155111"],
  // Polygon
  "137": process.env.RPC_URL_POLYGON || fallbackRpcUpstreams["137"],
};

export function getRpcUpstream(chainId: string): {upstream: string | undefined, fallback: string | undefined} {
  return {upstream: rpcUpstreams[chainId], fallback: fallbackRpcUpstreams[chainId]};
}
