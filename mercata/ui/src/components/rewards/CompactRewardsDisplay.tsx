import { UserRewardsData } from "@/services/rewardsService";
import {
  calculateRealTimePendingRewards,
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { Coins } from "lucide-react";

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
    ? formatRoundedWithCommas(roundByMagnitude(currentEmissionRateNumeric)) +
      " points/day"
    : "0 points/day";

  // If input has value, show current and new emission rates per day
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <Coins className="h-4 w-4 text-yellow-600" />
        <span className="text-muted-foreground">Current Emission Rate:</span>
        <span className="font-medium">{currentEmissionRateFormatted}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Coins className="h-4 w-4 text-yellow-600" />
        <span className="text-muted-foreground">New Emission Rate:</span>
        <span className="font-medium">{totalEstimatedWithInputFormatted}</span>
      </div>
    </div>
  );
};
