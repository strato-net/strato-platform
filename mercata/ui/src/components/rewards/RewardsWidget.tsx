import { UserRewardsData } from "@/services/rewardsService";
import {
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { TrendingUp, TrendingDown, Sparkles, Star, Coins } from "lucide-react";
import { Pool } from "@/interface";

// ============================================================================
// TYPES
// ============================================================================

interface RewardsWidgetProps {
  userRewards: UserRewardsData | null;
  activityName: string;
  // For most activities: direct input amount
  inputAmount?: string;
  // For withdrawals
  isWithdrawal?: boolean;
  // For LP deposits: pool data to calculate expected LP tokens
  poolData?: Pool | null;
  tokenAAmount?: string;
  tokenBAmount?: string;
  // For LP withdrawals: percentage and available balance
  withdrawPercent?: string;
  availableLPBalance?: string;
  // Action label for display (e.g., "Deposit", "Withdraw", "Swap")
  actionLabel?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate expected LP tokens for a dual-token deposit.
 * Formula: min(amountA * totalSupply / reserveA, amountB * totalSupply / reserveB)
 * For initial liquidity (totalSupply = 0): sqrt(amountA * amountB)
 */
const calculateExpectedLPTokens = (
  tokenAAmount: string,
  tokenBAmount: string,
  pool: Pool
): bigint => {
  try {
    const amountA = safeParseUnits(tokenAAmount || "0", 18);
    const amountB = safeParseUnits(tokenBAmount || "0", 18);
    const reserveA = BigInt(pool.tokenA.poolBalance || "0");
    const reserveB = BigInt(pool.tokenB.poolBalance || "0");
    const totalSupply = BigInt(pool.lpToken._totalSupply || "0");

    if (amountA === 0n && amountB === 0n) return 0n;

    // Initial liquidity - use geometric mean (sqrt)
    if (totalSupply === 0n || reserveA === 0n || reserveB === 0n) {
      const product = amountA * amountB;
      if (product === 0n) return 0n;
      // Integer square root using Newton's method
      let x = product;
      let y = (x + 1n) / 2n;
      while (y < x) {
        x = y;
        y = (x + product / x) / 2n;
      }
      return x;
    }

    // Subsequent liquidity - min of both ratios
    const lpFromA = (amountA * totalSupply) / reserveA;
    const lpFromB = (amountB * totalSupply) / reserveB;
    return lpFromA < lpFromB ? lpFromA : lpFromB;
  } catch {
    return 0n;
  }
};

/**
 * Calculate the stake change amount based on activity type and input.
 */
const calculateStakeChange = (
  activityName: string,
  isWithdrawal: boolean,
  inputAmount: string | undefined,
  poolData: Pool | null | undefined,
  tokenAAmount: string | undefined,
  tokenBAmount: string | undefined,
  withdrawPercent: string | undefined,
  availableLPBalance: string | undefined
): bigint => {
  const isLPActivity = activityName.toLowerCase().includes("swap lp");

  // LP Withdrawal: calculate from percentage of available balance
  if (isWithdrawal && withdrawPercent && availableLPBalance) {
    const lpBalance = BigInt(availableLPBalance);
    const percent = parseFloat(withdrawPercent);
    const percentScaled = BigInt(Math.floor(percent * 100));
    return (lpBalance * percentScaled) / 10000n;
  }

  // LP Deposit: calculate expected LP tokens from token amounts
  if (isLPActivity && poolData && !isWithdrawal) {
    const tokenA = tokenAAmount || inputAmount || "0";
    const tokenB = tokenBAmount || "0";
    return calculateExpectedLPTokens(tokenA, tokenB, poolData);
  }

  // Other activities (swaps, CDP, lending): use input amount directly
  return safeParseUnits(inputAmount || "0", 18);
};

/**
 * Calculate new stake values after the action.
 */
const calculateNewStakes = (
  oldStake: bigint,
  oldTotalStake: bigint,
  stakeChange: bigint,
  isWithdrawal: boolean
): { newStake: bigint; newTotalStake: bigint } => {
  if (isWithdrawal) {
    return {
      newStake: oldStake > stakeChange ? oldStake - stakeChange : 0n,
      newTotalStake: oldTotalStake > stakeChange ? oldTotalStake - stakeChange : 0n,
    };
  }
  return {
    newStake: oldStake + stakeChange,
    newTotalStake: oldTotalStake + stakeChange,
  };
};

/**
 * Format a BigInt rate value to display string.
 */
const formatRate = (rate: bigint): string => {
  const decimal = formatBalance(rate.toString(), "points", 18, 18, 18);
  const numeric = decimal.replace(/\s*points?\s*$/i, "").trim();
  return numeric ? formatRoundedWithCommas(roundByMagnitude(numeric)) : "0";
};

/**
 * Calculate percentage change between two rates.
 * Uses basis points to avoid precision loss from BigInt->Number conversion.
 */
const calculatePercentageChange = (
  oldRate: bigint,
  newRate: bigint
): number => {
  if (oldRate > 0n) {
    // Calculate in basis points (10000 = 100%) to maintain precision
    // Divide BigInt first to keep values in safe Number range
    const diff = newRate - oldRate;
    const basisPoints = (diff * 10000n) / oldRate;
    return Number(basisPoints) / 100;
  }
  return newRate > 0n ? 100 : 0;
};

// ============================================================================
// COMPONENT
// ============================================================================

export const RewardsWidget = ({
  userRewards,
  activityName,
  inputAmount,
  isWithdrawal = false,
  poolData,
  tokenAAmount,
  tokenBAmount,
  withdrawPercent,
  availableLPBalance,
  actionLabel = isWithdrawal ? "Withdraw" : "Deposit",
}: RewardsWidgetProps) => {
  // ─────────────────────────────────────────────────────────────────────────
  // FILTER MATCHING ACTIVITIES
  // ─────────────────────────────────────────────────────────────────────────
  const filteredActivities =
    userRewards?.activities.filter(
      (item) => item.activity.name.toLowerCase() === activityName.toLowerCase()
    ) || [];

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE CURRENT RATE (using backend's personalEmissionRate for accuracy)
  // ─────────────────────────────────────────────────────────────────────────
  let currentRate = 0n;
  
  // Store derived totalStake for use in new rate calculation
  const derivedTotalStakes: Map<number, bigint> = new Map();
  
  filteredActivities.forEach(({ activity, userInfo, personalEmissionRate }) => {
    if (activity?.emissionRate) {
      // Use backend's personalEmissionRate if available (more accurate than cached totalStake)
      if (personalEmissionRate && BigInt(personalEmissionRate) > 0n) {
        // Backend rate is per second, convert to per day
        const backendRatePerDay = BigInt(personalEmissionRate) * 86400n;
        currentRate += backendRatePerDay;
        
        // Derive actual totalStake from personalEmissionRate for use in estimates
        // Formula: personalEmissionRate = (userStake * emissionRate) / totalStake
        // So: totalStake = (userStake * emissionRate) / personalEmissionRate
        const userStakeBig = BigInt(userInfo?.stake || "0");
        const emissionRateBig = BigInt(activity.emissionRate);
        const personalRateBig = BigInt(personalEmissionRate);
        
        if (personalRateBig > 0n) {
          const derivedTotalStake = (userStakeBig * emissionRateBig) / personalRateBig;
          derivedTotalStakes.set(activity.activityId, derivedTotalStake);
        }
      } else if (activity?.totalStake) {
        // Fallback to calculated rate if no personalEmissionRate
        const rate = calculateEstimatedRewardsPerDay(
          userInfo?.stake || "0",
          activity.totalStake,
          activity.emissionRate
        );
        currentRate += BigInt(rate);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE NEW RATE WITH INPUT (using derived totalStake for accuracy)
  // ─────────────────────────────────────────────────────────────────────────
  const hasInput = inputAmount || (isWithdrawal && withdrawPercent && availableLPBalance);
  let newRate = 0n;

  if (hasInput) {
    try {
      filteredActivities.forEach(({ activity, userInfo }) => {
        if (activity?.emissionRate) {
          const stakeChange = calculateStakeChange(
            activityName,
            isWithdrawal,
            inputAmount,
            poolData,
            tokenAAmount,
            tokenBAmount,
            withdrawPercent,
            availableLPBalance
          );

          // Use derived totalStake if available, otherwise fall back to cached
          const actualTotalStake = derivedTotalStakes.get(activity.activityId) 
            || BigInt(activity.totalStake || "0");

          const { newStake, newTotalStake } = calculateNewStakes(
            BigInt(userInfo?.stake || "0"),
            actualTotalStake,
            stakeChange,
            isWithdrawal
          );

          if (newTotalStake > 0n) {
            const rate = calculateEstimatedRewardsPerDay(
              newStake.toString(),
              newTotalStake.toString(),
              activity.emissionRate
            );
            newRate += BigInt(rate);
          }
        }
      });
    } catch {
      newRate = 0n;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK INPUT STATE
  // ─────────────────────────────────────────────────────────────────────────
  const hasValidInput = isWithdrawal && withdrawPercent && availableLPBalance
    ? parseFloat(withdrawPercent) > 0
    : inputAmount && parseFloat(inputAmount) > 0;

  // Don't show if no activities found
  if (filteredActivities.length === 0) return null;
  if (isWithdrawal && newRate === 0n && currentRate === 0n) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE DISPLAY VALUES
  // ─────────────────────────────────────────────────────────────────────────
  const isIncrease = hasValidInput && newRate > currentRate;
  const isDecrease = hasValidInput && newRate < currentRate;
  const percentageChange = hasValidInput ? calculatePercentageChange(currentRate, newRate) : 0;
  const formattedCurrentRate = formatRate(currentRate);
  const formattedNewRate = formatRate(newRate);
  const formattedPercentage = Math.abs(percentageChange).toFixed(1);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-3 p-3 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950 dark:via-yellow-950 dark:to-orange-950 border border-amber-200 dark:border-amber-800 rounded-lg shadow-sm max-w-sm">
      {/* Current Rate - Always visible */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Coins className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">Earning Now</span>
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{formattedCurrentRate}</span>
          <span className="text-sm text-amber-600 dark:text-amber-400">pts/day</span>
        </div>
        <Sparkles className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
      </div>

      {/* New Rate - Shows when user types input */}
      {hasValidInput && (
        <div className={`mt-2 pt-2 border-t ${isIncrease ? 'border-green-200 dark:border-green-800' : isDecrease ? 'border-red-200 dark:border-red-800' : 'border-amber-200 dark:border-amber-800'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={`flex-shrink-0 ${isIncrease ? 'text-green-500' : isDecrease ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                {isIncrease ? <Star className="h-4 w-4 fill-current" /> : isDecrease ? <TrendingDown className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">After {actionLabel}</span>
              <span className={`text-sm font-semibold ${isIncrease ? 'text-green-600 dark:text-green-400' : isDecrease ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                {formattedNewRate}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">pts/day</span>
            </div>

            {/* Percentage Badge */}
            {(isIncrease || isDecrease) && percentageChange !== 0 && (
              <div className={`flex items-center gap-1 px-2 py-0.5 ${isIncrease ? 'bg-green-500' : 'bg-red-500'} rounded-full flex-shrink-0`}>
                {isIncrease ? (
                  <TrendingUp className="h-3 w-3 text-white" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-white" />
                )}
                <span className="text-xs font-semibold text-white">
                  {isIncrease ? "+" : "-"}{formattedPercentage}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
