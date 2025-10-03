// Safe wallet configuration

/**
 * Get Safe wallet address for a specific chain
 * @param chainId - External chain ID (e.g., 11155111 for Sepolia)
 * @returns Safe address or undefined if not configured
 */
export const getSafeAddress = (chainId: number): string => {
  const envVar = `SAFE_ADDRESS_${chainId}`;
  const safeAddress = process.env[envVar];

  if (!safeAddress) {
    console.error(`Error: Safe address not configured for chain ${chainId}. Set SAFE_ADDRESS_${chainId} environment variable.`);
    throw new Error("Could not fetch liquidity");
  }

  return safeAddress;
};

/**
 * Get RPC URL for a specific chain
 * @param chainId - External chain ID
 * @returns RPC URL
 * @throws Error if RPC URL is not configured
 */
export const getRpcUrl = (chainId: number): string => {
  const envVar = `CHAIN_${chainId}_RPC_URL`;
  const rpcUrl = process.env[envVar];
  
  if (!rpcUrl) {
    console.error(`Error: RPC URL not configured for chain ${chainId}. Set ${envVar} environment variable.`);
    throw new Error("Could not fetch liquidity");
  }
  
  return rpcUrl;
};

/**
 * Cache TTL for Safe balance queries (in milliseconds)
 */
export const SAFE_BALANCE_CACHE_TTL_MS = 60_000; // 60 seconds

