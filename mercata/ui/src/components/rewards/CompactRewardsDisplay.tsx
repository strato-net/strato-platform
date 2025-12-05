import { UserRewardsData } from "@/services/rewardsService";
import {
  calculateRealTimePendingRewards,
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { TrendingUp, TrendingDown, Sparkles, Star } from "lucide-react";

interface CompactRewardsDisplayProps {
  userRewards: UserRewardsData | null;
  activityName: string; // Activity name to match (e.g., "ETHST-USDST Swap LP", "CDP USDST Mint")
  inputAmount?: string; // Input amount for calculating estimated rewards per day
  isWithdrawal?: boolean; // If true, inputAmount will be subtracted instead of added (for withdrawals)
}

export const CompactRewardsDisplay = ({
  userRewards,
  activityName,
  inputAmount,
  isWithdrawal = false,
}: CompactRewardsDisplayProps) => {
  // Match activity by name (case-insensitive)
  const filteredActivities =
    userRewards?.activities.filter(
      (item) => item.activity.name.toLowerCase() === activityName.toLowerCase()
    ) || [];

  const activitiesWithStake = filteredActivities.filter(
    (a) => BigInt(a.userInfo.stake) > 0n
  );

  let totalPending = 0n;
  let totalEstimatedPerDay = 0n;
  const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds

  // Calculate pending rewards for activities with stake
  activitiesWithStake.forEach(({ activity, userInfo }) => {
    // Check all required fields are present for real-time calculation
    if (
      userInfo?.stake &&
      activity?.accRewardPerStake !== undefined &&
      userInfo?.userIndex !== undefined &&
      activity?.emissionRate !== undefined &&
      activity?.totalStake !== undefined &&
      activity?.lastUpdateTime !== undefined
    ) {
      const pending = calculateRealTimePendingRewards(
        userInfo.stake,
        activity.accRewardPerStake,
        userInfo.userIndex,
        activity.emissionRate,
        activity.totalStake,
        activity.lastUpdateTime,
        currentTime
      );
      totalPending += BigInt(pending);
    }
  });

  // Calculate current emission rate per day for all filtered activities (including those with 0 stake)
  filteredActivities.forEach(({ activity, userInfo }) => {
    if (activity?.emissionRate !== undefined && activity?.totalStake !== undefined) {
      const estimatedPerDay = calculateEstimatedRewardsPerDay(
        userInfo?.stake || "0",
        activity.totalStake,
        activity.emissionRate
      );
      totalEstimatedPerDay += BigInt(estimatedPerDay);
    }
  });

  // Calculate estimated rewards per day with input using the same formula as "My Rewards" section
  // For deposits: Formula: ((oldStake + input) / (oldTotalStake + input)) * emissionRate * secondsPerDay
  // For withdrawals: Formula: ((oldStake - input) / (oldTotalStake - input)) * emissionRate * secondsPerDay
  let totalEstimatedWithInput = 0n;
  if (inputAmount) {
    try {
      const inputWei = safeParseUnits(inputAmount || "0", 18);
      
      filteredActivities.forEach(({ activity, userInfo }) => {
        if (activity?.emissionRate !== undefined && activity?.totalStake !== undefined) {
          const oldStake = BigInt(userInfo?.stake || "0");
          const oldTotalStake = BigInt(activity.totalStake);
          
          // For withdrawals, subtract the amount; for deposits, add it
          const newStake = isWithdrawal 
            ? (oldStake > inputWei ? oldStake - inputWei : 0n)
            : oldStake + inputWei;
          const newTotalStake = isWithdrawal
            ? (oldTotalStake > inputWei ? oldTotalStake - inputWei : 0n)
            : oldTotalStake + inputWei;
          
          // Use the same formula as calculateEstimatedRewardsPerDay but with adjusted stake values
          if (newTotalStake > 0n && newStake >= 0n) {
            const estimatedPerDay = calculateEstimatedRewardsPerDay(
              newStake.toString(),
              newTotalStake.toString(),
              activity.emissionRate
            );
            totalEstimatedWithInput += BigInt(estimatedPerDay);
          }
        }
      });
    } catch {
      totalEstimatedWithInput = 0n;
    }
  }

  const totalEstimatedWithInputDecimal = formatBalance(
    totalEstimatedWithInput.toString(),
    "points",
    18,
    18,
    18
  );
  const totalEstimatedWithInputNumeric = totalEstimatedWithInputDecimal
    .replace(/\s*points?\s*$/i, "")
    .trim();
  const totalEstimatedWithInputFormatted = totalEstimatedWithInputNumeric
    ? formatRoundedWithCommas(
        roundByMagnitude(totalEstimatedWithInputNumeric)
      ) + " points/day"
    : "0 points/day";

  // Don't show anything until user enters input
  // For withdrawals, show even if new rate is 0 (user withdrawing all)
  if (
    !inputAmount ||
    parseFloat(inputAmount) === 0
  ) {
    return null;
  }
  
  // For withdrawals, if new rate would be invalid (negative), don't show
  if (isWithdrawal && totalEstimatedWithInput === 0n && totalEstimatedPerDay === 0n) {
    return null;
  }

  // Format current emission rate per day (already calculated above as totalEstimatedPerDay)
  const currentEmissionRateDecimal = formatBalance(
    totalEstimatedPerDay.toString(),
    "points",
    18,
    18,
    18
  );
  const currentEmissionRateNumeric = currentEmissionRateDecimal
    .replace(/\s*points?\s*$/i, "")
    .trim();
  const currentEmissionRateFormatted = currentEmissionRateNumeric
    ? formatRoundedWithCommas(roundByMagnitude(currentEmissionRateNumeric))
    : "0";

  // Calculate percentage change
  const currentRateNum = parseFloat(currentEmissionRateNumeric || "0");
  const newRateNum = parseFloat(totalEstimatedWithInputNumeric || "0");
  const isIncrease = newRateNum > currentRateNum;
  const isDecrease = newRateNum < currentRateNum;
  const percentageChange = currentRateNum > 0
    ? ((newRateNum - currentRateNum) / currentRateNum) * 100
    : 0;
  const percentageChangeFormatted = Math.abs(percentageChange).toFixed(1);

  // Determine styling based on increase/decrease - inspired by yo.xyz design
  const bgColor = isIncrease 
    ? "bg-gradient-to-br from-green-50 via-emerald-50 to-green-100 border-green-300"
    : isDecrease
    ? "bg-gradient-to-br from-orange-50 via-red-50 to-orange-100 border-orange-300"
    : "bg-gray-50 border-gray-200";
  
  const rateColor = isIncrease 
    ? "text-green-600" 
    : isDecrease 
    ? "text-red-600" 
    : "text-gray-800";
  
  const percentageBg = isIncrease
    ? "bg-green-500"
    : isDecrease
    ? "bg-red-500"
    : "bg-gray-500";

  // If input has value, show enhanced display inspired by yo.xyz
  return (
    <div className={`mt-3 p-4 ${bgColor} border-2 rounded-xl shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Icon */}
          <div className={`flex-shrink-0 ${isIncrease ? 'text-green-500' : isDecrease ? 'text-orange-500' : 'text-gray-500'}`}>
            {isIncrease ? (
              <Star className="h-5 w-5 fill-current" />
            ) : isDecrease ? (
              <TrendingDown className="h-5 w-5" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
          </div>
          
          {/* Text and Rate */}
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">
              {isIncrease ? "You'll Earn" : isDecrease ? "New Rate" : "Earning Rate"}
            </span>
            <span className={`text-lg font-bold ${rateColor} whitespace-nowrap`}>
              {formatRoundedWithCommas(roundByMagnitude(totalEstimatedWithInputNumeric))}
            </span>
            <span className="text-sm text-gray-600 whitespace-nowrap">points/day</span>
          </div>
        </div>
        
        {/* Percentage Badge */}
        {(isIncrease || isDecrease) && percentageChange !== 0 && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 ${percentageBg} rounded-full shadow-sm flex-shrink-0`}>
            {isIncrease ? (
              <TrendingUp className="h-4 w-4 text-white" />
            ) : (
              <TrendingDown className="h-4 w-4 text-white" />
            )}
            <span className="text-sm font-bold text-white">
              {isIncrease ? '+' : ''}{percentageChangeFormatted}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
