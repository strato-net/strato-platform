import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getPools } from "../services/swapping.service";
import { getPool as getLendingRegistry } from "../services/lending.service";
import { calculateLPTokenPrice } from "./swapping.helper";
import { getExchangeRateFromCirrus } from "../services/lending.service";

const { Token } = constants;

/**
 * Create a complete price map from raw oracle prices, including calculated LP token and mToken prices
 */
export const createCompletePriceMap = async (
  accessToken: string,
  rawPrices: Array<{ key: string; value: number }>
): Promise<Map<string, string>> => {
  // Start with oracle prices
  const priceMap = new Map<string, string>(rawPrices.map(p => [p.key, p.value.toString()]));

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
    const lendingData = await getLendingRegistry(accessToken, undefined, {
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