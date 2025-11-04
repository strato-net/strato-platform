import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getPools } from "../services/swapping.service";
import { getPool as getLendingRegistry } from "../services/lending.service";
import { calculateLPTokenPrice } from "./swapping.helper";
import { getExchangeRateFromCirrus } from "../services/lending.service";

const { Token } = constants;

/**
 * Converts a number to string without scientific notation
 * For very large numbers (like wei values), this ensures proper integer string representation
 */
const numberToString = (num: number | string): string => {
  if (typeof num === 'string') {
    return num;
  }
  
  // For very large numbers, use toLocaleString with full precision
  // This avoids scientific notation
  if (Math.abs(num) >= 1e21) {
    // Use toLocaleString with specific options to avoid scientific notation
    return num.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
  }
  
  // For smaller numbers, regular toString is fine
  return num.toString();
};

/**
 * Create a complete price map from raw oracle prices, including calculated LP token and mToken prices
 */
export const createCompletePriceMap = async (
  accessToken: string,
  rawPrices: Array<{ key: string; value: number | string }>
): Promise<Map<string, string>> => {
  // Start with oracle prices - use numberToString to avoid scientific notation
  // Handle both string and number values (value::text returns strings, but JSON may parse them as numbers)
  const priceMap = new Map<string, string>(rawPrices.map(p => [p.key, numberToString(p.value)]));

  // Add LP token prices
  try {
    const pools = await getPools(accessToken, undefined);
    for (const pool of pools) {
      if (!pool.lpToken?.address || !pool.lpToken?._totalSupply) continue;
      
      const tokenAPrice = priceMap.get(pool.tokenA?.address) || 0;
      const tokenBPrice = priceMap.get(pool.tokenB?.address) || 0;
      
      const lpTokenPrice = calculateLPTokenPrice(
        pool.tokenA.poolBalance || "0",
        pool.tokenB.poolBalance || "0",
        tokenAPrice.toString(),
        tokenBPrice.toString(),
        pool.lpToken._totalSupply
      );
      
      if (lpTokenPrice !== "0") {
        priceMap.set(pool.lpToken.address, lpTokenPrice.toString());
      }
    }
  } catch (error) {
    console.error("Error calculating LP token prices:", error);
  }

  // Add mToken price using exchange rate from Cirrus events
  try {
    const lendingData = await getLendingRegistry(accessToken, {
      select: "lendingPool:lendingPool_fkey(borrowableAsset,mToken),liquidityPool:liquidityPool_fkey(address)"
    });
    const { borrowableAsset, mToken } = lendingData.lendingPool || {};
    
    if (borrowableAsset && mToken) {
      const borrowableAssetPrice = priceMap.get(borrowableAsset) || "0";
      
      if (borrowableAssetPrice !== "0") {
        // Get exchange rate from Cirrus events instead of calculating manually
        const exchangeRate = await getExchangeRateFromCirrus(accessToken);
        
        // mToken price = borrowable asset price * exchange rate
        const mTokenPrice = (BigInt(borrowableAssetPrice.toString()) * BigInt(exchangeRate)) / BigInt(10 ** 18);
        
        priceMap.set(mToken, mTokenPrice.toString());
      }
    }
  } catch (error) {
    console.error("Error calculating mToken price:", error);
  }

  return priceMap;
}; 