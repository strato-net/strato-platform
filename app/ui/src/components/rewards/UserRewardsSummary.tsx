import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserRewardsData,
  RewardsState,
  claimAllRewards,
  safeBigInt,
  calculateRealTimePendingRewards,
  roundByMagnitude,
  formatRoundedWithCommas,
} from "@/services/rewardsService";
import { formatBalance, truncateAddress } from "@/utils/numberUtils";
import { Loader2, Coins, Star, Gift, Info, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";
import CopyButton from "@/components/ui/copy";
import { isTxPending } from "@/utils/transactionStatus";

interface UserRewardsSummaryProps {
  userRewards: UserRewardsData | null;
  loading: boolean;
  onClaimSuccess?: () => void;
  rewardsState?: RewardsState | null;
  rewardsStateLoading?: boolean;
}

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

export const UserRewardsSummary = ({
  userRewards,
  loading,
  onClaimSuccess,
  rewardsState,
  rewardsStateLoading,
}: UserRewardsSummaryProps) => {
  const { toast } = useToast();
  const { userAddress, isAppAuthenticated } = useUser();
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
      const result = await claimAllRewards(userAddress, { walletAuth: !isAppAuthenticated });

      if (result.success) {
        toast({
          title: isTxPending(result.status) ? "Claim Submitted" : "Claim Successful",
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

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  if (!userRewards) {
    return null;
  }

  const unclaimedRewardsStr = userRewards.unclaimedRewards || "0";
  const activitiesWithStake = userRewards.activities.filter(
    (a) =>
      safeBigInt(a.userInfo?.stake || "0") > 0n 
    // && safeBigInt(a.activity?.emissionRate || "0") > 0n
  );

  const hasBonusRewards = !!userRewards.bonusRewards && safeBigInt(userRewards.bonusRewards) > 0n;
  const bonusFormatted = hasBonusRewards
    ? formatRoundedWithCommas(roundByMagnitude(
        formatBalance(userRewards.bonusRewards!, "points", 18, 18, 18)
          .replace(/\s*points?\s*$/i, '').trim()
      )) + " points"
    : null;

  const baseUnclaimed = safeBigInt(unclaimedRewardsStr);
  let totalNewPending = 0n;
  const currentTime = Math.floor(Date.now() / 1000);
  activitiesWithStake.forEach(({ activity, userInfo }) => {
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
      totalNewPending += safeBigInt(pending);
    }
  });

  const totalClaimable = baseUnclaimed + totalNewPending;
  const hasClaimable = totalClaimable > 0n;
  const totalClaimableDecimal = totalClaimable >= 0n
    ? formatBalance(totalClaimable.toString(), "points", 18, 18, 18)
    : null;
  const numericPart = totalClaimableDecimal
    ? totalClaimableDecimal.replace(/\s*points?\s*$/i, '').trim()
    : null;
  const totalClaimableFormatted = numericPart !== null
    ? formatRoundedWithCommas(roundByMagnitude(numericPart)) + " points"
    : "?";

  const totalClaimedFormatted = formatRoundedWithCommas(roundByMagnitude(
    formatBalance(userRewards?.claimedRewards || "0", "points", 18, 18, 18)
      .replace(/\s*points?\s*$/i, '').trim()
  )) + " points";

  // Overview stats (global)
  const totalDistributedFormatted = rewardsState?.totalDistributed
    ? formatRoundedWithCommas(roundByMagnitude(String(parseFloat(rewardsState.totalDistributed) / 1e18)))
    : "0";
  const activityCountLabel = rewardsState?.activityCount !== undefined && rewardsState?.activityCount !== null && rewardsState.activityCount >= 0
    ? String(rewardsState.activityCount)
    : "?";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card>
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-3">
          <CardTitle className="text-sm md:text-base">
            Total Claimable Rewards{hasBonusRewards ? " (incl. Bonus)" : ""}
          </CardTitle>
          <CardDescription className="text-xs">Rewards ready to claim now</CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="flex flex-col items-start gap-3">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <Coins className="h-4 w-4 text-gold" />
                <p className="text-lg md:text-xl font-bold tabular-nums">{totalClaimableFormatted}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Amount you will receive if you click "Claim All"
              </p>
            </div>
            <Button
              onClick={handleClaimAll}
              disabled={!hasClaimable || isClaimingAll || !userAddress}
              size="sm"
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

      <Card>
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-3">
          <CardTitle className="text-sm md:text-base">My Claimed Rewards</CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6 space-y-3">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <Star className="h-4 w-4 text-gold" />
              <p className="text-lg md:text-xl font-bold tabular-nums">{totalClaimedFormatted}</p>
            </div>
            <p className="text-xs text-muted-foreground">Reward Points</p>
          </div>
          {hasBonusRewards && (
            <div className="pt-2 border-t border-border">
              <div className="flex items-center gap-1.5 mb-1">
                <p className="text-xs text-muted-foreground">Community Bonus</p>
                <InfoTooltip content="Community bonus points earned this season. Unclaimed amounts are already included in your Total Claimable Rewards; claimed amounts are included in Total Claimed." />
              </div>
              <div className="flex items-center space-x-2">
                <Gift className="h-4 w-4 text-success" />
                <p className="text-base md:text-lg font-semibold tabular-nums">{bonusFormatted}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-3">
          <CardTitle className="text-sm md:text-base">Global Rewards Overview</CardTitle>
          <CardDescription className="text-xs">Rewards statistics over all users</CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {rewardsStateLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-muted rounded animate-pulse" />
              <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
              <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
            </div>
          ) : (
            <div className="space-y-2 text-xs md:text-sm">
              <div className="flex items-center gap-2">
                <Star className="h-3.5 w-3.5 text-gold shrink-0" />
                <span className="text-muted-foreground">Total Earned:</span>
                <span className="font-semibold truncate">{totalDistributedFormatted}</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-muted-foreground">Activities:</span>
                <span className="font-semibold truncate">{activityCountLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Coins className="h-3.5 w-3.5 text-success shrink-0" />
                <span className="text-muted-foreground">Reward Token:</span>
                {rewardsState?.rewardToken ? (
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="font-semibold font-mono truncate">
                      {truncateAddress(rewardsState.rewardToken)}
                    </span>
                    <CopyButton address={rewardsState.rewardToken} />
                  </span>
                ) : (
                  <span className="font-semibold">?</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
