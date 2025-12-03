import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserRewardsData } from "@/services/rewardsService";
import {
  calculatePendingRewards,
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { Coins } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CompactRewardsDisplayProps {
  userRewards: UserRewardsData | null;
  loading: boolean;
  activityIds: number[];
  variant?: "button" | "inline";
  inputAmount?: string; // Input amount for calculating 1% estimated rewards
}

const truncateActivityName = (name: string, maxLength: number = 30): string => {
  if (!name || name.length <= maxLength) return name;
  return name.substring(0, maxLength) + "...";
};

export const CompactRewardsDisplay = ({
  userRewards,
  loading,
  activityIds,
  variant = "button",
  inputAmount,
}: CompactRewardsDisplayProps) => {
  const filteredActivities = userRewards?.activities.filter((item) =>
    activityIds.includes(item.activityId)
  ) || [];

  const activitiesWithStake = filteredActivities.filter(
    (a) => BigInt(a.userInfo.stake) > 0n
  );

  let totalPending = 0n;
  let totalEstimatedPerDay = 0n;

  activitiesWithStake.forEach(({ activity, userInfo }) => {
    const pending = calculatePendingRewards(
      userInfo.stake,
      activity.accRewardPerStake,
      userInfo.userIndex
    );
    totalPending += BigInt(pending);

    const estimatedPerDay = calculateEstimatedRewardsPerDay(
      userInfo.stake,
      activity.totalStake,
      activity.emissionRate
    );
    totalEstimatedPerDay += BigInt(estimatedPerDay);
  });

  const totalPendingDecimal = formatBalance(
    totalPending.toString(),
    "points",
    18,
    18,
    18
  );
  const totalPendingNumeric = totalPendingDecimal.replace(/\s*points?\s*$/i, '').trim();
  const totalPendingFormatted = totalPendingNumeric 
    ? formatRoundedWithCommas(roundByMagnitude(totalPendingNumeric)) + " points"
    : "0 points";
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

  // Button variant - for header
  if (variant === "button") {
    if (loading || !hasRewards) return null;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Coins className="h-4 w-4" />
            <span className="hidden sm:inline">Rewards</span>
            {totalPending > 0n && (
              <Badge variant="secondary" className="ml-1">
                {totalPendingFormatted}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">Your Rewards</h4>
              <Link to="/dashboard/rewards">
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  View All
                </Button>
              </Link>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Est. per Day</span>
                <span className="font-medium">{totalEstimatedPerDayFormatted}</span>
              </div>
            </div>
            {activitiesWithStake.map(({ activity }) => (
              <div key={activity.activityId} className="pt-2 border-t text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{truncateActivityName(activity.name)}</span>
                  <Badge variant="outline" className="text-xs">
                    {activity.activityType === 0 ? "Position" : "One-Time"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Inline variant - for below input fields
  if (variant === "inline") {
    if (loading) {
      return (
        <div className="text-sm text-muted-foreground mt-2">
          Loading rewards...
        </div>
      );
    }

    // Show existing rewards even if input is empty
    if (!hasRewards && inputAmountReward === 0n) return null;

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

    // If input is empty, show only existing estimated rewards
    if (inputAmountReward === 0n) {
      return (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <Coins className="h-4 w-4 text-yellow-600" />
          <span className="text-muted-foreground">Estimated Rewards:</span>
          <span className="font-medium">{totalEstimatedPerDayFormatted}</span>
        </div>
      );
    }

    // If input has value, show total with 1% breakdown
    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <Coins className="h-4 w-4 text-yellow-600" />
          <span className="text-muted-foreground">Estimated Rewards:</span>
          <span className="font-medium">{totalEstimatedWithInputFormatted} </span>
        </div>
        {inputAmountReward > 0n && (
          <div className="text-xs text-muted-foreground pl-6">
            + {inputAmountRewardFormatted} points (1% of input)
          </div>
        )}
      </div>
    );
  }

  return null;
};

