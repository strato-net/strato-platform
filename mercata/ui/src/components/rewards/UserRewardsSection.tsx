import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRewardsData } from "@/services/rewardsService";
import {
  calculatePendingRewards,
  calculateEstimatedRewardsPerDay,
  formatEmissionRatePerDay,
} from "@/services/rewardsService";
import { formatBalance, formatUnits, ensureHexPrefix } from "@/utils/numberUtils";
import { Loader2, Coins, TrendingUp, Percent } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWriteContract } from "wagmi";
import { rewardsAddress } from "@/lib/constants";
import { REWARDS_ABI } from "@/lib/rewards/constants";
import { useState } from "react";

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
  const { writeContractAsync, isPending } = useWriteContract();
  const [claimingActivityIds, setClaimingActivityIds] = useState<number[]>([]);

  const handleClaimAll = async () => {
    try {
      setClaimingActivityIds([]);
      const contractAddress = ensureHexPrefix(rewardsAddress);
      if (!contractAddress) {
        throw new Error("Invalid rewards contract address");
      }
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: REWARDS_ABI,
        functionName: "claimAllRewards",
      });

      toast({
        title: "Claim Transaction Sent",
        description: `Transaction hash: ${hash.slice(0, 10)}...`,
      });

      onClaimSuccess?.();
    } catch (error: any) {
      toast({
        title: "Claim Failed",
        description: error?.message || "Failed to claim rewards",
        variant: "destructive",
      });
    }
  };

  const handleClaimActivity = async (activityIds: number[]) => {
    try {
      setClaimingActivityIds(activityIds);
      const contractAddress = ensureHexPrefix(rewardsAddress);
      if (!contractAddress) {
        throw new Error("Invalid rewards contract address");
      }
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: REWARDS_ABI,
        functionName: "claimRewards",
        args: [activityIds],
      });

      toast({
        title: "Claim Transaction Sent",
        description: `Transaction hash: ${hash.slice(0, 10)}...`,
      });

      onClaimSuccess?.();
    } catch (error: any) {
      toast({
        title: "Claim Failed",
        description: error?.message || "Failed to claim rewards",
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
          <p className="text-muted-foreground text-center py-8">Connect your wallet to view rewards</p>
        </CardContent>
      </Card>
    );
  }

  const unclaimedFormatted = formatBalance(userRewards.unclaimedRewards, "points", 18, 2, 6);
  const hasUnclaimed = BigInt(userRewards.unclaimedRewards) > 0n;
  const activitiesWithStake = userRewards.activities.filter(
    (a) => BigInt(a.userInfo.stake) > 0n
  );

  // Calculate total pending across all activities
  let totalPending = BigInt(userRewards.unclaimedRewards);
  activitiesWithStake.forEach(({ activity, userInfo }) => {
    const pending = calculatePendingRewards(
      userInfo.stake,
      activity.accRewardPerStake,
      userInfo.userIndex
    );
    totalPending += BigInt(pending);
  });
  const totalPendingFormatted = formatBalance(totalPending.toString(), "points", 18, 2, 6);

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
                <p className="text-3xl font-bold">{unclaimedFormatted}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Estimated total including pending: {totalPendingFormatted}
              </p>
            </div>
            <Button
              onClick={handleClaimAll}
              disabled={!hasUnclaimed || isPending}
              size="lg"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Claiming...
                </>
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
          {activitiesWithStake.map(({ activity, userInfo }) => {
            const stakeFormatted = formatBalance(userInfo.stake, "", 18, 2, 6);
            const totalStakeFormatted = formatBalance(activity.totalStake, "", 18, 2, 6);
            const share = BigInt(activity.totalStake) > 0n
              ? (BigInt(userInfo.stake) * 10000n) / BigInt(activity.totalStake) / 100n
              : 0n;

            const pending = calculatePendingRewards(
              userInfo.stake,
              activity.accRewardPerStake,
              userInfo.userIndex
            );
            const pendingFormatted = formatBalance(pending, "points", 18, 2, 6);

            const estimatedPerDay = calculateEstimatedRewardsPerDay(
              userInfo.stake,
              activity.totalStake,
              activity.emissionRate
            );
            const estimatedPerDayFormatted = formatBalance(estimatedPerDay, "points", 18, 2, 6);

            const isClaiming = claimingActivityIds.includes(activity.activityId);
            const hasPending = BigInt(pending) > 0n;

            return (
              <Card key={activity.activityId}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{activity.name}</CardTitle>
                      <CardDescription>
                        Activity #{activity.activityId} •{" "}
                        <Badge variant={activity.activityType === 0 ? "default" : "secondary"}>
                          {activity.activityType === 0 ? "Position" : "One-Time"}
                        </Badge>
                      </CardDescription>
                    </div>
                    {hasPending && (
                      <Button
                        onClick={() => handleClaimActivity([activity.activityId])}
                        disabled={isClaiming}
                        size="sm"
                        variant="outline"
                      >
                        {isClaiming ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Claiming...
                          </>
                        ) : (
                          "Claim"
                        )}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Your Stake</p>
                      </div>
                      <p className="text-lg font-semibold">{stakeFormatted}</p>
                    </div>

                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <Percent className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Pool Share</p>
                      </div>
                      <p className="text-lg font-semibold">{share.toString()}%</p>
                      <p className="text-xs text-muted-foreground">
                        of {totalStakeFormatted} total
                      </p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Estimated Rewards/Day</p>
                      <p className="text-lg font-semibold">{estimatedPerDayFormatted} points</p>
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Pending Rewards</p>
                      <p className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">
                        {pendingFormatted} points
                      </p>
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

