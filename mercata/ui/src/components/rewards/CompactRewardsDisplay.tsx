import { UserRewardsData } from "@/services/rewardsService";
import {
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { TrendingUp, TrendingDown, Sparkles, Star } from "lucide-react";
import { Pool } from "@/interface";

// ============================================================================
// TYPES
// ============================================================================

interface CompactRewardsDisplayProps {
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
 */
const calculatePercentageChange = (
  oldRate: bigint,
  newRate: bigint
): number => {
  if (oldRate > 0n) {
    const oldFloat = Number(oldRate) / 1e18;
    const newFloat = Number(newRate) / 1e18;
    return ((newFloat - oldFloat) / oldFloat) * 100;
  }
  return newRate > 0n ? 100 : 0;
};

// ============================================================================
// COMPONENT
// ============================================================================

export const CompactRewardsDisplay = ({
  userRewards,
  activityName,
  inputAmount,
  isWithdrawal = false,
  poolData,
  tokenAAmount,
  tokenBAmount,
  withdrawPercent,
  availableLPBalance,
}: CompactRewardsDisplayProps) => {
  // ─────────────────────────────────────────────────────────────────────────
  // FILTER MATCHING ACTIVITIES
  // ─────────────────────────────────────────────────────────────────────────
  const filteredActivities =
    userRewards?.activities.filter(
      (item) => item.activity.name.toLowerCase() === activityName.toLowerCase()
    ) || [];

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE CURRENT RATE
  // ─────────────────────────────────────────────────────────────────────────
  let currentRate = 0n;
  filteredActivities.forEach(({ activity, userInfo }) => {
    if (activity?.emissionRate && activity?.totalStake) {
      currentRate += BigInt(
        calculateEstimatedRewardsPerDay(
          userInfo?.stake || "0",
          activity.totalStake,
          activity.emissionRate
        )
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE NEW RATE WITH INPUT
  // ─────────────────────────────────────────────────────────────────────────
  const hasInput = inputAmount || (isWithdrawal && withdrawPercent && availableLPBalance);
  let newRate = 0n;

  if (hasInput) {
    try {
      filteredActivities.forEach(({ activity, userInfo }) => {
        if (activity?.emissionRate && activity?.totalStake) {
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

          const { newStake, newTotalStake } = calculateNewStakes(
            BigInt(userInfo?.stake || "0"),
            BigInt(activity.totalStake),
            stakeChange,
            isWithdrawal
          );

          if (newTotalStake > 0n) {
            newRate += BigInt(
              calculateEstimatedRewardsPerDay(
                newStake.toString(),
                newTotalStake.toString(),
                activity.emissionRate
              )
            );
          }
        }
      });
    } catch {
      newRate = 0n;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EARLY RETURNS
  // ─────────────────────────────────────────────────────────────────────────
  const hasValidInput = isWithdrawal && withdrawPercent && availableLPBalance
    ? parseFloat(withdrawPercent) > 0
    : inputAmount && parseFloat(inputAmount) > 0;

  if (!hasValidInput) return null;
  if (isWithdrawal && newRate === 0n && currentRate === 0n) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE DISPLAY VALUES
  // ─────────────────────────────────────────────────────────────────────────
  const isIncrease = newRate > currentRate;
  const isDecrease = newRate < currentRate;
  const percentageChange = calculatePercentageChange(currentRate, newRate);
  const formattedRate = formatRate(newRate);
  const formattedPercentage = Math.abs(percentageChange).toFixed(1);

  // ─────────────────────────────────────────────────────────────────────────
  // STYLING
  // ─────────────────────────────────────────────────────────────────────────
  const styles = {
    container: isIncrease
      ? "bg-gradient-to-br from-green-50 via-emerald-50 to-green-100 border-green-300"
      : isDecrease
      ? "bg-gradient-to-br from-orange-50 via-red-50 to-orange-100 border-orange-300"
      : "bg-gray-50 border-gray-200",
    icon: isIncrease ? "text-green-500" : isDecrease ? "text-orange-500" : "text-gray-500",
    rate: isIncrease ? "text-green-600" : isDecrease ? "text-red-600" : "text-gray-800",
    badge: isIncrease ? "bg-green-500" : isDecrease ? "bg-red-500" : "bg-gray-500",
  };

  const label = isIncrease ? "You'll Earn" : isDecrease ? "New Rate" : "Earning Rate";
  const Icon = isIncrease ? Star : isDecrease ? TrendingDown : Sparkles;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`mt-3 p-4 ${styles.container} border-2 rounded-xl shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        {/* Left: Icon + Rate */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`flex-shrink-0 ${styles.icon}`}>
            <Icon className={`h-5 w-5 ${isIncrease ? "fill-current" : ""}`} />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
              {label}
            </span>
            <span className={`text-lg font-bold ${styles.rate} whitespace-nowrap`}>
              {formattedRate}
            </span>
            <span className="text-sm text-gray-600 whitespace-nowrap">points/day</span>
          </div>
        </div>

        {/* Right: Percentage Badge */}
        {(isIncrease || isDecrease) && percentageChange !== 0 && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 ${styles.badge} rounded-full shadow-sm flex-shrink-0`}>
            {isIncrease ? (
              <TrendingUp className="h-4 w-4 text-white" />
            ) : (
              <TrendingDown className="h-4 w-4 text-white" />
            )}
            <span className="text-sm font-bold text-white">
              {isIncrease ? "+" : ""}{formattedPercentage}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
