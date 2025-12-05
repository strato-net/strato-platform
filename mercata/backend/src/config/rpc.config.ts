type RpcMapping = Record<string, string | undefined>;

export const rpcUpstreams: RpcMapping = {
  // Ethereum mainnet
  "1": process.env.RPC_URL_MAINNET || "https://eth.merkle.io",
  // Sepolia
  "11155111": process.env.RPC_URL_SEPOLIA || "https://sepolia.drpc.org",
  // Polygon
  "137": process.env.RPC_URL_POLYGON || "https://polygon-rpc.com",
};

export function getRpcUpstream(chainId: string): string | undefined {
  return rpcUpstreams[chainId];
}

