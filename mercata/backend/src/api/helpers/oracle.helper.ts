import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { calculateLPTokenPrice } from "./swapping.helper";
import { getExchangeRateFromCirrus } from "../services/lending.service";
import { getOraclePrices } from "../services/oracle.service";
import { getSafetyModuleConfig } from "../services/safety.service";
import * as config from "../../config/config";
import { OraclePriceMap } from "@mercata/shared-types";

const { Token, DECIMALS, Pool, LendingPool, lendingRegistry } = constants;

const addMTokenPrice = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const [{ data: lendingData }, exchangeRate] = await Promise.all([
    cirrus.get(accessToken, `/${LendingPool}`, {
      params: {
        select: "mToken",
        registry: `eq.${lendingRegistry}`
      }
    }),
    getExchangeRateFromCirrus(accessToken)
  ]);
  priceMap.set(lendingData[0].mToken, exchangeRate);
};

const addSTokenPrice = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const { safetyModule, sToken } = getSafetyModuleConfig();

  // Fetch managedAssets and totalShares in parallel
  const [smRes, stRes] = await Promise.all([
    cirrus.get(accessToken, `/BlockApps-SafetyModule`, {
      params: {
        address: `eq.${safetyModule.address}`,
        select: "_managedAssets::text"
      }
    }),
    cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `eq.${sToken.address}`,
        select: "_totalSupply::text"
      }
    })
  ]);

  const managedAssets = BigInt(smRes.data?.[0]?._managedAssets ?? "0");
  const totalShares   = BigInt(stRes.data?.[0]?._totalSupply ?? "0");

  const exchangeRate = calculateSTokenPrice(
    managedAssets,
    totalShares
  );

  priceMap.set(sToken.address, exchangeRate.toString());
}

export const calculateSTokenPrice = (managedAssets: bigint, totalShares: bigint): bigint => {
  // If no shares exist, define price = 1e18 (initial exchange rate)
  if (totalShares === 0n) {
    return DECIMALS;
  }

  // exchangeRate = (managedAssets / totalShares) * 1e18
  return (managedAssets * DECIMALS) / totalShares;
};

const addLPTokenPrices = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      poolFactory: `eq.${config.poolFactory}`,
      select: "tokenA,tokenB,tokenABalance::text,tokenBBalance::text,lpToken:lpToken_fkey(address,_totalSupply::text)"
    }
  });

  poolData.forEach((pool: any) => {
    if (!pool.lpToken) return; // Skip if lpToken is null
    const lpTokenPrice = calculateLPTokenPrice(
      pool.tokenABalance || "0",
      pool.tokenBBalance || "0",
      priceMap.get(pool.tokenA) || "0",
      priceMap.get(pool.tokenB) || "0",
      pool?.lpToken?.['_totalSupply'] || "0"
    );
    priceMap.set(pool.lpToken.address, lpTokenPrice);
  });
};

export const getCompletePriceMap = async (
  accessToken: string
): Promise<Map<string, string>> => {
  const priceMap = await getOraclePrices(accessToken);
  await Promise.all([
    addMTokenPrice(accessToken, priceMap),
    addSTokenPrice(accessToken, priceMap),
    addLPTokenPrices(accessToken, priceMap)
  ]);
  return priceMap;
};