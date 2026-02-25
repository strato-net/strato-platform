import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRewardsData, claimAllRewards, claimRewards, safeBigInt } from "@/services/rewardsService";
import {
  calculateRealTimePendingRewards,
  formatEmissionRatePerDay,
  roundByMagnitude,
  formatRoundedWithCommas,
} from "@/services/rewardsService";
import { formatBalance, calculateTokenValue, safeParseUnits } from "@/utils/numberUtils";
import { Loader2, Coins, TrendingUp, Info, Clock, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { useOracleContext } from "@/context/OracleContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { getActivityLink } from "@/lib/rewards/activityLinks";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";

interface UserRewardsSectionProps {
  userRewards: UserRewardsData | null;
  loading: boolean;
  onClaimSuccess?: () => void;
}

// Mobile-friendly Info Tooltip component
const InfoTooltip = ({ content }: { content: string }) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip('stake-info-tooltip-container');

  if (isMobile) {
    return (
      <div className="relative stake-info-tooltip-container inline-flex">
        <Info 
          className="h-3 w-3 text-muted-foreground cursor-pointer" 
          onClick={handleToggle}
        />
        {showTooltip && (
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] bg-popover border rounded-lg px-4 py-3 text-sm text-popover-foreground shadow-lg max-w-[85vw] w-[320px]">
            <p className="text-center">{content}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggle(e);
              }}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
            >
              <span className="sr-only">Close</span>
              ×
            </button>
          </div>
        )}
        {showTooltip && (
          <div 
            className="fixed inset-0 z-[99] bg-black/20"
            onClick={handleToggle}
          />
        )}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export const UserRewardsSection = ({
  userRewards,
  loading,
  onClaimSuccess,
}: UserRewardsSectionProps) => {
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { getPrice } = useOracleContext();
  const [claimingActivityIds, setClaimingActivityIds] = useState<number[]>([]);
  const [isClaimingAll, setIsClaimingAll] = useState(false);

  const handleClaimAll = async () => {
    if (!userAddress) {
      toast({
        title: "User Not Logged In",
        description: "Please log in to claim rewards",
        variant: "destructive",
      });
      return;
    }

    if (!userRewards) {
      toast({
        title: "No Rewards",
        description: "You don't have any rewards to claim",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsClaimingAll(true);
      setClaimingActivityIds([]);
      
      const result = await claimAllRewards(userAddress);
      
      if (result.success) {
        toast({
          title: "Claim Successful",
          description: result.txHash 
            ? `Transaction hash: ${result.txHash.slice(0, 10)}...`
            : "Rewards claimed successfully",
        });
        onClaimSuccess?.();
      } else {
        throw new Error("Claim failed");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to claim rewards";
      toast({
        title: "Claim Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsClaimingAll(false);
    }
  };

  const handleClaimActivity = async (activityIds: number[]) => {
    if (!userAddress) {
      toast({
        title: "User Not Logged In",
        description: "Please log in to claim rewards",
        variant: "destructive",
      });
      return;
    }

    if (!userRewards) {
      toast({
        title: "No Rewards",
        description: "You don't have any rewards to claim",
        variant: "destructive",
      });
      return;
    }

    try {
      setClaimingActivityIds(activityIds);
      
      const result = await claimRewards(userAddress, activityIds);
      
      if (result.success) {
        toast({
          title: "Claim Successful",
          description: result.txHash 
            ? `Transaction hash: ${result.txHash.slice(0, 10)}...`
            : "Rewards claimed successfully",
        });
        onClaimSuccess?.();
      } else {
        throw new Error("Claim failed");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to claim rewards";
      toast({
        title: "Claim Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setClaimingActivityIds([]);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Rewards</CardTitle>
          <CardDescription>Your rewards breakdown by activity</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!userRewards) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Rewards</CardTitle>
          <CardDescription>Your rewards breakdown by activity</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            {userAddress ? "No rewards found for your address" : "Please log in to view your rewards"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const unclaimedRewardsStr = userRewards.unclaimedRewards || "0";
  const unclaimedFormatted = formatBalance(unclaimedRewardsStr, "points", 18, 2, 6);
  const activitiesWithStake = userRewards.activities.filter(
    (a) => safeBigInt(a.userInfo?.stake || "0") > 0n
  );

  // Calculate what user would receive if they claim:
  // - claimAllRewards: settles all activities, then claims total unclaimedRewards[user]
  // - claimRewards(activityId): settles that activity, then claims total unclaimedRewards[user]
  // So both claim the total, but after settling different activities
  
  // Calculate new pending rewards that haven't been settled yet for each activity
  const baseUnclaimed = safeBigInt(unclaimedRewardsStr);
  let totalNewPending = 0n;
  
  // Pre-calculate pending for each activity using real-time calculation
  const activityPendingMap = new Map<number, bigint>();
  const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
  activitiesWithStake.forEach(({ activity, userInfo }) => {
    // Check for existence, not truthiness (0 is valid for userIndex)
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
        userInfo.userIndex || "0",
        activity.emissionRate,
        activity.totalStake,
        activity.lastUpdateTime,
        currentTime
      );
      const pendingBig = safeBigInt(pending);
      activityPendingMap.set(activity.activityId, pendingBig);
      totalNewPending += pendingBig;
    }
  });
  
  // Total claimable = base unclaimed + new pending from all activities
  const totalClaimable = baseUnclaimed + totalNewPending;
  const hasClaimable = totalClaimable > 0n;
  const totalClaimableDecimal = totalClaimable >= 0n
    ? formatBalance(totalClaimable.toString(), "points", 18, 18, 18)
    : null;
  // Extract just the numeric part (remove "points" suffix and any spaces)
  const numericPart = totalClaimableDecimal
    ? totalClaimableDecimal.replace(/\s*points?\s*$/i, '').trim()
    : null;
  const totalClaimableFormatted = numericPart !== null
    ? formatRoundedWithCommas(roundByMagnitude(numericPart)) + " points" 
    : "?";

  return (
    <div className="space-y-6">
      {/* Total Claimable and Total Earned Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Total Claimable Card */}
      <Card>
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-4">
          <CardTitle className="text-base md:text-lg">Total Claimable Rewards</CardTitle>
          <CardDescription className="text-xs md:text-sm">Rewards ready to claim now</CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2 mb-1 md:mb-2">
                <Coins className="h-4 w-4 md:h-5 md:w-5 text-yellow-500" />
                <p className="text-2xl md:text-3xl font-bold">{totalClaimableFormatted}</p>
              </div>
              <p className="text-xs md:text-sm text-muted-foreground">
                Amount you will receive if you click "Claim All"
              </p>
            </div>
            <Button
              onClick={handleClaimAll}
              disabled={!hasClaimable || isClaimingAll || !userAddress}
              size="lg"
              className="w-full md:w-auto"
            >
              {isClaimingAll ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Claiming...
                </>
              ) : !userAddress ? (
                "Log In to Claim"
              ) : (
                "Claim All"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

        {/* Total Earned Card */}
        <Card>
          <CardHeader className="px-4 md:px-6 pb-2 md:pb-4">
            <CardTitle className="text-base md:text-lg">Total Claimed</CardTitle>
          </CardHeader>
          <CardContent className="px-4 md:px-6">
            <div className="flex items-center space-x-2 mb-1 md:mb-2">
              <Star className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
              <p className="text-2xl md:text-3xl font-bold">
                {formatRoundedWithCommas(roundByMagnitude(
                  formatBalance(userRewards?.claimedRewards || "0", "points", 18, 18, 18)
                    .replace(/\s*points?\s*$/i, '').trim()
                ))} points
              </p>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground">
              Reward Points
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Activities with Stake */}
      {activitiesWithStake.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-muted-foreground text-center">
              You don't have any active positions in reward activities
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Your Activity Positions</h3>
          {activitiesWithStake.map(({ activity, userInfo, personalEmissionRate }) => {
            // Format stake values with magnitude-aware rounding
            const userStakeStr = userInfo?.stake || null;
            const totalStakeStr = activity?.totalStake || null;
            const userStakeDecimal = userStakeStr ? formatBalance(userStakeStr, "", 18, 18, 18) : null;
            const totalStakeDecimal = totalStakeStr ? formatBalance(totalStakeStr, "", 18, 18, 18) : null;
            const userStakeFormatted = userStakeDecimal ? formatRoundedWithCommas(roundByMagnitude(userStakeDecimal)) : "?";
            const totalStakeFormatted = totalStakeDecimal ? formatRoundedWithCommas(roundByMagnitude(totalStakeDecimal)) : "?";

            // Use personalEmissionRate (already calculated as emissionRate * (userStake / totalStake))
            // Multiply by secondsPerDay to get estimated rewards per day
            const secondsPerDay = BigInt(86400);
            const personalEmissionRateStr = personalEmissionRate || null;
            const personalEmissionRateBig = personalEmissionRateStr ? safeBigInt(personalEmissionRateStr) : null;
            const estimatedPerDay = personalEmissionRateBig
              ? (personalEmissionRateBig * secondsPerDay).toString()
              : null;
            const estimatedPerDayDecimal = estimatedPerDay
              ? formatBalance(estimatedPerDay, "points", 18, 18, 18)
              : null;
            // Extract just the numeric part (remove "points" suffix and any spaces)
            const estimatedPerDayNumeric = estimatedPerDayDecimal
              ? estimatedPerDayDecimal.replace(/\s*points?\s*$/i, '').trim()
              : null;
            const estimatedPerDayFormatted = estimatedPerDayNumeric
              ? formatRoundedWithCommas(roundByMagnitude(estimatedPerDayNumeric)) + " points"
              : "?";

            // Format last update time
            const lastUpdateTimeStr = activity?.lastUpdateTime || null;
            const lastUpdate = lastUpdateTimeStr ? new Date(Number(lastUpdateTimeStr) * 1000) : null;
            const timeAgo = lastUpdate ? formatDistanceToNow(lastUpdate, { addSuffix: true }) : "?";

            const activityLink = activity?.name ? getActivityLink(activity.name) : null;
            const displayName = activity?.name 
              ? (activity.name.length > 30 
                  ? activity.name.substring(0, 30) + "..." 
                  : activity.name)
              : "?";

            return (
              <Card key={activity.activityId}>
                <CardHeader>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {activity?.name ? (
                        activityLink ? (
                          <Link
                            to={activityLink}
                            className="text-primary hover:underline transition-colors"
                          >
                            {displayName}
                          </Link>
                        ) : (
                          displayName
                        )
                      ) : "?"}
                      <Badge variant="secondary">
                        {activity?.activityType !== undefined && activity?.activityType !== null
                          ? (activity.activityType === 1 ? "One-Time" : "Position")
                          : "?"}
                      </Badge>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Stake</p>
                        <InfoTooltip content="Your total staked amount in this activity. This determines your share of rewards based on your proportion of the total stake." />
                      </div>
                      <p className="text-lg font-semibold">{userStakeFormatted}</p>
                      {totalStakeFormatted !== "?" && (
                        <p className="text-xs text-muted-foreground mt-1">
                          of {totalStakeFormatted} total
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Estimated Rewards/Day</p>
                      <p className="text-lg font-semibold">{estimatedPerDayFormatted}</p>
                      {(() => {
                        // Show pts/$1/day based on *user* stake USD (personal normalization)
                        if (!activity || estimatedPerDayFormatted === "?" || !userInfo) return null;

                        const userStakeUsd =
                          userInfo.stakeUsd !== null && userInfo.stakeUsd !== undefined
                            ? BigInt(userInfo.stakeUsd)
                            : (activity.stakeUnitPriceUsd
                                ? (BigInt(userInfo.stake || "0") * BigInt(activity.stakeUnitPriceUsd)) / BigInt(10 ** 18)
                                : (activity.stakeDenomination === "usd_notional" ? BigInt(userInfo.stake || "0") : 0n));

                        if (userStakeUsd === 0n) return null;

                        const estimatedPerDayBig = BigInt(estimatedPerDay || "0");
                        const ptsPerDollarPerDay = (estimatedPerDayBig * BigInt(10 ** 18)) / userStakeUsd;
                        const formatted = formatRoundedWithCommas(
                          roundByMagnitude(formatBalance(ptsPerDollarPerDay.toString(), "", 18, 18, 18))
                        );

                        return (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatted} pts/$1/day
                          </p>
                        );
                      })()}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Last Update</p>
                      </div>
                      <p className="text-lg font-semibold">{timeAgo}</p>
                    </div>

                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

