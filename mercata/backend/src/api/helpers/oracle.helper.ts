import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getPools } from "../services/swapping.service";
import { getPool as getLendingRegistry } from "../services/lending.service";
import { calculateLPTokenPrice } from "./swapping.helper";
import { getExchangeRateFromCirrus } from "../services/lending.service";

const { Token } = constants;

const getSafetyModuleConfig = () => {
  return {
    safetyModule: {
      address: process.env.SAFETY_MODULE || "0000000000000000000000000000000000001015"
    },
    asset: {
      address: process.env.USDST_ADDRESS || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010"
    },
    sToken: {
      address: process.env.SUSDST_ADDRESS || "0000000000000000000000000000000000001016"
    }
  };
};

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

  // Add sUSDST price using SafetyModule exchange rate
  try {
    const safetyModuleConfig = getSafetyModuleConfig();
    const safetyModuleAddress = safetyModuleConfig.safetyModule.address;
    const sTokenAddress = safetyModuleConfig.sToken.address;
    const assetAddress = safetyModuleConfig.asset.address;

    const [usdstBalanceResponse, sTokenSupplyResponse] = await Promise.all([
      cirrus.get(accessToken, `/${Token}`, {
        params: {
          address: `eq.${assetAddress}`,
          select: `balances:${Token}-_balances(user:key,balance:value::text)`,
          "balances.key": `eq.${safetyModuleAddress}`
        }
      }),
      cirrus.get(accessToken, `/${Token}`, {
        params: {
          address: `eq.${sTokenAddress}`,
          select: "_totalSupply::text"
        }
      })
    ]);

    const usdstBalance = usdstBalanceResponse.data?.[0]?.balances?.[0]?.balance || "0";
    const totalShares = sTokenSupplyResponse.data?.[0]?._totalSupply || "0";
    const assetPrice = priceMap.get(assetAddress) || "0";

    if (assetPrice !== "0" && totalShares !== "0" && BigInt(totalShares) > 0n) {
      // Calculate exchange rate: (totalAssets * 1e18) / totalShares
      const exchangeRate = (BigInt(usdstBalance) * BigInt("1000000000000000000")) / BigInt(totalShares);
      
      // sUSDST price = USDST price * exchange rate / 1e18
      const sTokenPrice = (BigInt(assetPrice.toString()) * exchangeRate) / BigInt("1000000000000000000");
      
      priceMap.set(sTokenAddress, sTokenPrice.toString());
    }
  } catch (error) {
    console.error("Error calculating sUSDST price:", error);
  }
  console.log("priceMap", priceMap);
  return priceMap;
}; 