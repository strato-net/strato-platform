import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getPools } from "../services/swapping.service";
import { getPool as getLendingRegistry } from "../services/lending.service";
import { calculateLPTokenPrice } from "./swapping.helper";
import { calculateExchangeRate } from "./lending.helper";

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
        pool.tokenABalance || "0",
        pool.tokenBBalance || "0",
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

  // Add mToken price
  try {
    const lendingData = await getLendingRegistry(accessToken, undefined, {
      select: "lendingPool:lendingPool_fkey(borrowableAsset,mToken,totalBorrowPrincipal::text),liquidityPool:liquidityPool_fkey(address)"
    });
    const { borrowableAsset, mToken, totalBorrowPrincipal } = lendingData.lendingPool || {};
    
    if (borrowableAsset && mToken && lendingData.liquidityPool?.address) {
      const borrowableAssetPrice = priceMap.get(borrowableAsset) || "0";
      
      if (borrowableAssetPrice !== "0") {
        // Get token data to calculate exchange rate
        const tokenParams = {
          address: `in.(${borrowableAsset},${mToken})`,
          select: `address,_totalSupply::text,balances:${Token}-_balances(user:key,balance:value::text)`,
          "balances.key": `in.(${lendingData.liquidityPool.address})`
        };
        
        const tokenResponse = await cirrus.get(accessToken, "/" + Token, { params: tokenParams });
        const tokenData = tokenResponse.data || [];
        
        const borrowableToken = tokenData.find((token: any) => token.address === borrowableAsset);
        const mTokenInfo = tokenData.find((token: any) => token.address === mToken);
        
        const totalMTokenSupply = mTokenInfo?._totalSupply || "0";
        const availableLiquidity = borrowableToken?.balances?.find((b: any) => b.user === lendingData.liquidityPool.address)?.balance || "0";
        
        const totalUSDSTSupplied = (BigInt(availableLiquidity) + BigInt(totalBorrowPrincipal || "0")).toString();
        const exchangeRate = calculateExchangeRate(totalMTokenSupply, totalUSDSTSupplied);
        
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