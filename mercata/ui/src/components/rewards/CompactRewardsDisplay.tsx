import { UserRewardsData } from "@/services/rewardsService";
import {
  calculateRealTimePendingRewards,
  calculateEstimatedRewardsPerDay,
  calculateEffectiveEmissionRate,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { Coins } from "lucide-react";

interface CompactRewardsDisplayProps {
  userRewards: UserRewardsData | null;
  activityName: string; // Activity name to match (e.g., "ETHST-USDST Swap LP", "CDP USDST Mint")
  inputAmount?: string; // Input amount for calculating estimated rewards per day
}

export const CompactRewardsDisplay = ({
  userRewards,
  activityName,
  inputAmount,
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

    // Calculate estimated rewards per day: (userStake / totalStake) * emissionRate * secondsPerDay
    const estimatedPerDay = calculateEstimatedRewardsPerDay(
      userInfo.stake,
      activity.totalStake,
      activity.emissionRate
    );
    totalEstimatedPerDay += BigInt(estimatedPerDay);
  });

  // Calculate estimated rewards per day with input using the same formula as "My Rewards" section
  // Formula: ((oldStake + input) / (oldTotalStake + input)) * emissionRate * secondsPerDay
  let totalEstimatedWithInput = 0n;
  if (inputAmount) {
    try {
      const inputWei = safeParseUnits(inputAmount || "0", 18);
      
      filteredActivities.forEach(({ activity, userInfo }) => {
        if (activity?.emissionRate !== undefined && activity?.totalStake !== undefined) {
          const oldStake = BigInt(userInfo?.stake || "0");
          const oldTotalStake = BigInt(activity.totalStake);
          const newStake = oldStake + inputWei;
          const newTotalStake = oldTotalStake + inputWei;
          
          // Use the same formula as calculateEstimatedRewardsPerDay but with adjusted stake values
          if (newTotalStake > 0n) {
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
  if (
    !inputAmount ||
    parseFloat(inputAmount) === 0 ||
    totalEstimatedWithInput === 0n
  ) {
    return null;
  }

  // Calculate effective emission rate based on input amount using the function
  let totalEffectiveEmissionRate = 0n;

  filteredActivities.forEach(({ activity }) => {
    const inputWei = safeParseUnits(inputAmount || "0", 18);
    const effectiveEmissionRate = calculateEffectiveEmissionRate(
      inputWei.toString(),
      activity.totalStake,
      activity.emissionRate
    );
    totalEffectiveEmissionRate += BigInt(effectiveEmissionRate);
  });

  const effectiveRewardsPerDayDecimal = formatBalance(
    totalEffectiveEmissionRate.toString(),
    "points",
    18,
    18,
    18
  );
  const effectiveRewardsPerDayNumeric = effectiveRewardsPerDayDecimal
    .replace(/\s*points?\s*$/i, "")
    .trim();
  const effectiveRewardsPerDayFormatted = effectiveRewardsPerDayNumeric
    ? formatRoundedWithCommas(roundByMagnitude(effectiveRewardsPerDayNumeric)) +
      " points/day"
    : "0 points/day";

  // If input has value, show estimated rewards per day and effective emission rate
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <Coins className="h-4 w-4 text-yellow-600" />
        <span className="text-muted-foreground">Estimated Rewards:</span>
        <span className="font-medium">{totalEstimatedWithInputFormatted} </span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Coins className="h-4 w-4 text-yellow-600" />
        <span className="text-muted-foreground">Effective Emission Rate:</span>
        <span className="font-medium">{effectiveRewardsPerDayFormatted}</span>
      </div>
    </div>
  );
};
