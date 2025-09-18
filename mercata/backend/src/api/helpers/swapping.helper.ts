import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { SwapToken } from "../../types/swaps";

const { Pool } = constants;

export const getRawPoolData = async (
  accessToken: string,
  params: Record<string, string> = {}
) => {
  const queryParams = {
    _owner: "eq." + constants.poolFactory,
    ...params
  };

  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, { params: queryParams });
  return poolData;
};

export const calculateImpliedPrice = (
  amountIn: string,
  amountOut: string,
  isAToB: boolean
): string => {
  try {
    const inBig = BigInt(amountIn);
    const outBig = BigInt(amountOut);
    
    if (!inBig || !outBig) return '0.00';
    
    // Always calculate as TokenB/TokenA
    const price = isAToB 
      ? (outBig * 10n**18n) / inBig  // A→B: out/in
      : (inBig * 10n**18n) / outBig; // B→A: in/out
    
    return (Number(price) / 1e18).toFixed(6);
  } catch {
    return '0.00';
  }
};

/**
 * Calculate pool APY based on actual fees earned over 24h
 * @param fees24h 24-hour fees earned by LPs in USD
 * @param totalLiquidity Total value locked in the pool in USD
 * @returns APY as a percentage
 */
export const calculatePoolAPY = (
  fees24h: string,
  totalLiquidity: string
): number => {
  const fees = parseFloat(fees24h);
  const liquidity = parseFloat(totalLiquidity);

  if (!fees || !liquidity) return 0;

  return Math.max(0, (fees / liquidity) * 365 * 100);
};

/**
 * Calculate fees earned by LPs from trading volume
 * @param tradingVolume24h 24-hour trading volume in USD
 * @param swapFeeRate Swap fee rate in basis points (e.g., 30 = 0.3%)
 * @param lpSharePercent LP share percentage in basis points (e.g., 7000 = 70%)
 * @returns Fees earned by LPs in USD
 */
export const calculateLPFees24h = (
  tradingVolume24h: string,
  swapFeeRate: number,
  lpSharePercent: number
): string => {
  const volume = parseFloat(tradingVolume24h);
  if (!volume) return "0";

  const totalFees = volume * (swapFeeRate / 10000);
  const lpFees = totalFees * (lpSharePercent / 10000);

  return lpFees.toString();
};

/**
 * Calculate LP token price based on underlying token values
 * @param tokenABalance Balance of token A in the pool
 * @param tokenBBalance Balance of token B in the pool
 * @param tokenAPrice Price of token A in USD
 * @param tokenBPrice Price of token B in USD
 * @param lpTokenTotalSupply Total supply of LP tokens
 * @returns LP token price in USD
 */
export const calculateLPTokenPrice = (
  tokenABalance: string,
  tokenBBalance: string,
  tokenAPrice: string,
  tokenBPrice: string,
  lpTokenTotalSupply: string
): string => {
  const toBig = (v: string) => (v ? BigInt(v) : 0n);
  const aBal = toBig(tokenABalance);
  const bBal = toBig(tokenBBalance);
  const aPrice = toBig(tokenAPrice);
  const bPrice = toBig(tokenBPrice);
  const supply = toBig(lpTokenTotalSupply);

  if (supply === 0n) return "0";
  if ((aBal === 0n && bBal === 0n) || (aPrice === 0n && bPrice === 0n)) return "0";

  const Q = 10n ** 18n;
  const totalValueUSD = (aBal * aPrice + bBal * bPrice) / Q; // both prices are 1e18-scaled

  return ((totalValueUSD * Q) / supply).toString();
};

export const buildPoolParams = (rawParams: Record<string, string | undefined>, userAddress?: string) => ({
  ...Object.fromEntries(Object.entries(rawParams).filter(([_, v]) => v !== undefined)),
  select: rawParams.select || constants.poolSelectFields.join(","),
  ...(rawParams.select || !userAddress ? {} : {
    "lpToken.balances.value": "gt.0",
    "lpToken.balances.key": `eq.${userAddress}`,
    "tokenA.balances.value": "gt.0",
    "tokenA.balances.key": `eq.${userAddress}`,
    "tokenB.balances.value": "gt.0",
    "tokenB.balances.key": `eq.${userAddress}`,
  }),
});

export const extractTokenAddresses = (poolData: any[]) => [
  ...new Set([
    ...poolData.map(p => p.tokenA?.address).filter(Boolean),
    ...poolData.map(p => p.tokenB?.address).filter(Boolean)
  ])
];

export const calculatePoolMetrics = (pool: any, tokenAPrice: string, tokenBPrice: string, volume24h: string, factoryData: any) => {
  const tokenAValue = (BigInt(pool.tokenABalance || "0") * BigInt(tokenAPrice)) / BigInt(10 ** 18);
  const tokenBValue = (BigInt(pool.tokenBBalance || "0") * BigInt(tokenBPrice)) / BigInt(10 ** 18);
  const totalLiquidityUSD = (tokenAValue + tokenBValue).toString();
  
  const swapFeeRate = pool.swapFeeRate || factoryData?.swapFeeRate || 30;
  const lpSharePercent = pool.lpSharePercent || factoryData?.lpSharePercent || 7000;
  
  const fees24h = calculateLPFees24h(volume24h, swapFeeRate, lpSharePercent);
  const apy = calculatePoolAPY(fees24h, totalLiquidityUSD);
  
  const lpTokenPrice = calculateLPTokenPrice(
    pool.tokenABalance || "0",
    pool.tokenBBalance || "0",
    tokenAPrice,
    tokenBPrice,
    pool.lpToken?._totalSupply || "0"
  );
  
  return { totalLiquidityUSD, apy, lpTokenPrice, swapFeeRate, lpSharePercent };
};

export const calculateOracleRatios = (tokenAPrice: string, tokenBPrice: string) => {
  if (tokenAPrice === "0" || tokenBPrice === "0") return { aToB: "0", bToA: "0" };
  return {
    aToB: (Number(tokenAPrice) / Number(tokenBPrice)).toFixed(18),
    bToA: (Number(tokenBPrice) / Number(tokenAPrice)).toFixed(18)
  };
};

export const buildSwapToken = (token: any, price: string, poolBalance: string, userBalance: string): SwapToken => ({
  address: token?.address || "",
  _name: token?._name || "",
  _symbol: token?._symbol || "",
  customDecimals: token?.customDecimals || 18,
  _totalSupply: token?._totalSupply || "0",
  balance: userBalance,
  price,
  poolBalance
});

export const buildLPToken = (lpToken: any, price: string, userBalance: string) => ({
  address: lpToken?.address || "",
  _name: lpToken?._name || "",
  _symbol: lpToken?._symbol || "",
  customDecimals: lpToken?.customDecimals || 18,
  _totalSupply: lpToken?._totalSupply || "0",
  balance: userBalance,
  price
});