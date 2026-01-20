import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RewardsState, formatEmissionRatePerDay, formatEmissionRatePerWeek, safeBigInt, roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import { formatUnits } from "viem";
import { Coins, Zap, Clock, RefreshCw, Star } from "lucide-react";
import CopyButton from "@/components/ui/copy";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface RewardsOverviewProps {
  state: RewardsState | null;
  loading: boolean;
  onRefresh?: () => void;
}


const truncateTokenAddress = (address: string, front: number = 6, back: number = 4) => {
  if (!address) return "";
  if (address.length <= front + back) return address;
  return `${address.substring(0, front)}...${address.substring(address.length - back)}`;
};

export const RewardsOverview = ({ state, loading, onRefresh }: RewardsOverviewProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    try {
      setIsRefreshing(true);
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Build season display from currentSeason
  const seasonDisplay = `Season ${state?.currentSeason || 1}`;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{seasonDisplay} Reward Overview</CardTitle>
          <CardDescription>Global rewards system statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reward Overview</CardTitle>
          <CardDescription>Global rewards system statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  // Total Emission Rate should show the raw totalRewardsEmission (points per second)
  // Convert to string first to handle numbers that might be in scientific notation
  // Treat "0" as missing data (should show "?")
  const totalRewardsEmissionStr = state.totalRewardsEmission ? String(state.totalRewardsEmission) : null;
  const totalRewardsEmissionBig = totalRewardsEmissionStr ? safeBigInt(totalRewardsEmissionStr) : null;
  const hasValidEmission = totalRewardsEmissionBig !== null && totalRewardsEmissionBig > 0n;
  
  const totalStakeStr = state.totalStake ? String(state.totalStake) : null;
  const totalStakeBig = totalStakeStr ? safeBigInt(totalStakeStr) : null;
  const hasValidStake = totalStakeBig !== null && totalStakeBig > 0n;

  const emissionPerDay = hasValidEmission && totalRewardsEmissionStr
    ? formatEmissionRatePerDay(totalRewardsEmissionStr)
    : "?";
  const emissionPerWeek = hasValidEmission && totalRewardsEmissionStr
    ? formatEmissionRatePerWeek(totalRewardsEmissionStr)
    : "?";
  const totalStakeDecimal = hasValidStake && totalStakeStr
    ? formatUnits(totalStakeBig, 18)
    : null;
  const totalStakeFormatted = totalStakeDecimal ? formatRoundedWithCommas(roundByMagnitude(totalStakeDecimal)) : "?";

  return (
    <Card>
      <CardHeader className="px-4 md:px-6 pb-3 md:pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg md:text-xl">{seasonDisplay} Reward Overview</CardTitle>
            <CardDescription className="text-xs md:text-sm">Global rewards system statistics</CardDescription>
          </div>
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading || isRefreshing}
              className="flex items-center gap-2 px-2 md:px-3"
            >
              <RefreshCw className={`h-4 w-4 ${(loading || isRefreshing) ? "animate-spin" : ""}`} />
              <span className="hidden md:inline">Refresh</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Zap className="h-4 w-4 md:h-5 md:w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs md:text-sm text-muted-foreground">Total Emission Rate</p>
              <p className="text-xl md:text-2xl font-semibold">{emissionPerDay} {emissionPerDay !== "?" && "points/day"}</p>
              {emissionPerWeek !== "?" && (
                <p className="text-xs text-muted-foreground mt-1">{emissionPerWeek} points/week</p>
              )}
              {totalStakeFormatted !== "?" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Total Stake: {totalStakeFormatted}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
              <Star className="h-4 w-4 md:h-5 md:w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs md:text-sm text-muted-foreground">Total Earned</p>
              <p className="text-xl md:text-2xl font-semibold">
                {state.totalDistributed ? 
                  formatRoundedWithCommas(roundByMagnitude(String(parseFloat(state.totalDistributed) / 1e18))) 
                  : "0"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Reward Points</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <Coins className="h-4 w-4 md:h-5 md:w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs md:text-sm text-muted-foreground">Reward Token</p>
              {state.rewardToken && (
                <div className="flex items-center gap-1 mt-1">
                  <p className="text-sm font-semibold font-mono">
                    {truncateTokenAddress(state.rewardToken)}
                  </p>
                  <CopyButton address={state.rewardToken} />
                </div>
              )}
              {!state.rewardToken && (
                <p className="text-sm font-semibold mt-1">?</p>
              )}
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Clock className="h-4 w-4 md:h-5 md:w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs md:text-sm text-muted-foreground">Last Update</p>
              <p className="text-base md:text-lg font-semibold">
                {state.lastBlockHandled && state.lastBlockHandled !== "0"
                  ? `Block ${state.lastBlockHandled}`
                  : "?"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {state.activityCount !== undefined && state.activityCount !== null && state.activityCount >= 0
                  ? `${state.activityCount} ${state.activityCount === 1 ? "activity" : "activities"}`
                  : "?"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

