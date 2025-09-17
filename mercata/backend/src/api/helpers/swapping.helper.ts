import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

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

export const getInputPrice = (
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): string => {
  if (inputAmount <= BigInt(0) || inputReserve <= BigInt(0) || outputReserve <= BigInt(0)) {
    throw new Error("Invalid amounts or reserves");
  }

  const numerator = inputAmount * outputReserve;
  const denominator = inputReserve + inputAmount;

  return String(numerator / denominator);
};

export const getRequiredInput = (
  outputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): string => {
  if (outputAmount <= BigInt(0) || inputReserve <= BigInt(0) || outputReserve <= BigInt(0)) {
    throw new Error("Invalid amounts or reserves");
  }
  
  if (outputAmount >= outputReserve) {
    throw new Error("Desired output amount exceeds pool reserves");
  }

  // This is the inverse of the getInputPrice formula
  // If the forward formula is: outputAmount = (inputAmount * outputReserve) / (inputReserve + inputAmount)
  // Then the reverse is: inputAmount = (inputReserve * outputAmount) / (outputReserve - outputAmount)
  
  const numerator = inputReserve * outputAmount;
  const denominator = outputReserve - outputAmount;
  
  // Add 1 to round up (to ensure user provides enough input)
  return String(numerator / denominator + BigInt(1));
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