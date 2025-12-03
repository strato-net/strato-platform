import { UserRewardsData } from "@/services/rewardsService";
import {
  calculatePendingRewards,
  calculateEstimatedRewardsPerDay,
  calculateEffectiveEmissionRate,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { Coins } from "lucide-react";

interface CompactRewardsDisplayProps {
  userRewards: UserRewardsData | null;
  loading: boolean;
  activityName: string; // Activity name to match (e.g., "ETHST-USDST Swap LP", "CDP USDST Mint")
  variant?: "button" | "inline";
  inputAmount?: string; // Input amount for calculating 1% estimated rewards
}


export const CompactRewardsDisplay = ({
  userRewards,
  activityName,
  variant = "button",
  inputAmount,
}: CompactRewardsDisplayProps) => {
  // Match activity by name (case-insensitive)
  const filteredActivities = userRewards?.activities.filter((item) =>
    item.activity.name.toLowerCase() === activityName.toLowerCase()
  ) || [];

  const activitiesWithStake = filteredActivities.filter(
    (a) => BigInt(a.userInfo.stake) > 0n
  );

  let totalPending = 0n;
  let totalEstimatedPerDay = 0n;

  activitiesWithStake.forEach(({ activity, userInfo }) => {
    // Calculate pending rewards using the calculatePendingRewards function
    const pending = calculatePendingRewards(
      userInfo.stake,
      activity.accRewardPerStake,
      userInfo.userIndex
    );
    totalPending += BigInt(pending);

    // Calculate estimated rewards per day: (userStake / totalStake) * emissionRate * secondsPerDay
    const estimatedPerDay = calculateEstimatedRewardsPerDay(
      userInfo.stake,
      activity.totalStake,
      activity.emissionRate
    );
    totalEstimatedPerDay += BigInt(estimatedPerDay);
  });

  // Calculate 1% of input amount for estimated rewards
  let inputAmountReward = 0n;
  if (inputAmount && variant === "inline") {
    try {
      const inputWei = safeParseUnits(inputAmount || "0", 18);
      // 1% of input amount
      inputAmountReward = (inputWei * 1n) / 100n;
    } catch {
      inputAmountReward = 0n;
    }
  }

  // Add input amount reward (1%) to total estimated per day
  const totalEstimatedWithInput = totalEstimatedPerDay + inputAmountReward;

  const totalEstimatedPerDayDecimal = formatBalance(
    totalEstimatedPerDay.toString(),
    "points",
    18,
    18,
    18
  );
  const totalEstimatedPerDayNumeric = totalEstimatedPerDayDecimal.replace(/\s*points?\s*$/i, '').trim();
  const totalEstimatedPerDayFormatted = totalEstimatedPerDayNumeric
    ? formatRoundedWithCommas(roundByMagnitude(totalEstimatedPerDayNumeric)) + " points"
    : "0 points";

  const totalEstimatedWithInputDecimal = formatBalance(
    totalEstimatedWithInput.toString(),
    "points",
    18,
    18,
    18
  );
  const totalEstimatedWithInputNumeric = totalEstimatedWithInputDecimal.replace(/\s*points?\s*$/i, '').trim();
  const totalEstimatedWithInputFormatted = totalEstimatedWithInputNumeric
    ? formatRoundedWithCommas(roundByMagnitude(totalEstimatedWithInputNumeric)) + " points"
    : "0 points";

  const hasRewards = totalPending > 0n || totalEstimatedPerDay > 0n || inputAmountReward > 0n;

  // Inline variant - for below input fields
  if (variant === "inline") {
    // Don't show anything until user enters input
    if (!inputAmount || parseFloat(inputAmount) === 0 || inputAmountReward === 0n) {
      return null;
    }
   
    const inputAmountRewardDecimal = formatBalance(
      inputAmountReward.toString(),
      "points",
      18,
      18,
      18
    );
    const inputAmountRewardNumeric = inputAmountRewardDecimal.replace(/\s*points?\s*$/i, '').trim();
    const inputAmountRewardFormatted = inputAmountRewardNumeric
      ? formatRoundedWithCommas(roundByMagnitude(inputAmountRewardNumeric)) + " points"
      : "0 points";

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
    const effectiveRewardsPerDayNumeric = effectiveRewardsPerDayDecimal.replace(/\s*points?\s*$/i, '').trim();
    const effectiveRewardsPerDayFormatted = effectiveRewardsPerDayNumeric
      ? formatRoundedWithCommas(roundByMagnitude(effectiveRewardsPerDayNumeric)) + " points/day"
      : "0 points/day";

    // If input has value, show total with 1% breakdown and effective emission rate
    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <Coins className="h-4 w-4 text-yellow-600" />
          <span className="text-muted-foreground">Estimated Rewards:</span>
          <span className="font-medium">{totalEstimatedWithInputFormatted} </span>
        </div>
        {inputAmountReward > 0n && (
          <div className="text-xs text-muted-foreground pl-6">
            + {inputAmountRewardFormatted} (1% of input)
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Coins className="h-4 w-4 text-yellow-600" />
          <span className="text-muted-foreground">Effective Emission Rate:</span>
          <span className="font-medium">{effectiveRewardsPerDayFormatted}</span>
        </div>
      </div>
    );
  }

  return null;
};

