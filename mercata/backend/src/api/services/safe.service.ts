import { ethers } from "ethers";
import { getSafeAddress, getRpcUrl, SAFE_BALANCE_CACHE_TTL_MS } from "../../config/safe.config";

// ERC-20 ABI for balanceOf function
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Cache for balance data to reduce RPC calls
interface CachedBalance {
  balance: string;
  balanceFormatted: string;
  decimals: number;
  timestamp: number;
}

const balanceCache = new Map<string, CachedBalance>();

/**
 * Fetches the ERC-20 token balance of a Safe wallet on an external chain
 * @param chainId - External chain ID (e.g., 11155111 for Sepolia)
 * @param tokenAddress - ERC-20 token contract address
 * @returns Balance information including wei and formatted values
 */
export const getSafeLiquidity = async (
  chainId: number,
  tokenAddress: string
): Promise<{
  chainId: number;
  tokenAddress: string;
  safeAddress: string;
  balance: string;
  balanceFormatted: string;
  decimals: number;
  symbol: string;
  timestamp: number;
}> => {
  // Validate and get Safe address
  const safeAddress = getSafeAddress(chainId);

  // Normalize token address
  const normalizedTokenAddress = ethers.getAddress(tokenAddress);
  const cacheKey = `${chainId}-${normalizedTokenAddress}`;

  // Check cache
  const cached = balanceCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < SAFE_BALANCE_CACHE_TTL_MS) {
    return {
      chainId,
      tokenAddress: normalizedTokenAddress,
      safeAddress,
      balance: cached.balance,
      balanceFormatted: cached.balanceFormatted,
      decimals: cached.decimals,
      symbol: "", // Not cached, but not critical
      timestamp: cached.timestamp,
    };
  }

  // Get RPC URL and connect to chain
  const rpcUrl = getRpcUrl(chainId);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Create contract instance
  const tokenContract = new ethers.Contract(normalizedTokenAddress, ERC20_ABI, provider);

  // Fetch balance and token metadata in parallel
  const [balanceRaw, decimalsRaw, symbol] = await Promise.all([
    tokenContract.balanceOf(safeAddress),
    tokenContract.decimals(),
    tokenContract.symbol(),
  ]);

  // Convert to proper types (ethers v6 returns bigint for uint values)
  const balance = BigInt(balanceRaw);
  const decimals = Number(decimalsRaw);

  // Format balance for human readability
  const balanceFormatted = ethers.formatUnits(balance, decimals);

  // Cache the result
  const cacheData: CachedBalance = {
    balance: balance.toString(),
    balanceFormatted,
    decimals,
    timestamp: now,
  };
  balanceCache.set(cacheKey, cacheData);

  return {
    chainId,
    tokenAddress: normalizedTokenAddress,
    safeAddress,
    balance: balance.toString(),
    balanceFormatted,
    decimals,
    symbol: String(symbol),
    timestamp: now,
  };
};

/**
 * Clears the balance cache (useful for testing or force refresh)
 */
export const clearBalanceCache = (): void => {
  balanceCache.clear();
};

