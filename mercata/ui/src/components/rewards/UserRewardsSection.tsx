import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRewardsData, claimAllRewards, claimRewards, safeBigInt } from "@/services/rewardsService";
import {
  calculatePendingRewards,
  formatEmissionRatePerDay,
  roundByMagnitude,
  formatRoundedWithCommas,
} from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { Loader2, Coins, TrendingUp, Info, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

interface UserRewardsSectionProps {
  userRewards: UserRewardsData | null;
  loading: boolean;
  onClaimSuccess?: () => void;
}

export const UserRewardsSection = ({
  userRewards,
  loading,
  onClaimSuccess,
}: UserRewardsSectionProps) => {
  const { toast } = useToast();
  const { userAddress } = useUser();
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
  const hasUnclaimed = safeBigInt(unclaimedRewardsStr) > 0n;
  const hasAnyRewards = hasUnclaimed || userRewards.activities.some(
    (a) => safeBigInt(a.userInfo?.stake || "0") > 0n
  );
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
  
  // Pre-calculate pending for each activity
  const activityPendingMap = new Map<number, bigint>();
  activitiesWithStake.forEach(({ activity, userInfo }) => {
    if (userInfo?.stake && activity?.accRewardPerStake && userInfo?.userIndex) {
      const pending = calculatePendingRewards(
        userInfo.stake,
        activity.accRewardPerStake,
        userInfo.userIndex
      );
      const pendingBig = safeBigInt(pending);
      activityPendingMap.set(activity.activityId, pendingBig);
      totalNewPending += pendingBig;
    }
  });
  
  // Total claimable = base unclaimed + new pending from all activities
  const totalClaimable = baseUnclaimed + totalNewPending;
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
      {/* Total Claimable Card */}
      <Card>
        <CardHeader>
          <CardTitle>Total Claimable Rewards</CardTitle>
          <CardDescription>Rewards ready to claim now</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <Coins className="h-5 w-5 text-yellow-500" />
                <p className="text-3xl font-bold">{totalClaimableFormatted}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Amount you will receive if you click "Claim All"
              </p>
            </div>
            <Button
              onClick={handleClaimAll}
              disabled={!hasUnclaimed || isClaimingAll || !userAddress}
              size="lg"
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

            return (
              <Card key={activity.activityId}>
                <CardHeader>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {activity?.name 
                        ? (activity.name.length > 30 
                            ? activity.name.substring(0, 30) + "..." 
                            : activity.name)
                        : "?"}
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Your total staked amount in this activity. This determines your share of rewards based on your proportion of the total stake.
                            </p>
                          </TooltipContent>
                        </Tooltip>
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

