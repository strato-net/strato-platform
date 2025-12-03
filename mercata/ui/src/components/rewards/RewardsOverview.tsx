import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RewardsState, formatEmissionRatePerDay, formatEmissionRatePerWeek, safeBigInt, roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import { formatUnits } from "viem";
import { Coins, Zap, Clock } from "lucide-react";

interface RewardsOverviewProps {
  state: RewardsState | null;
  loading: boolean;
}

const truncateTokenAddress = (address: string, front: number = 6, back: number = 4) => {
  if (!address) return "";
  if (address.length <= front + back) return address;
  return `${address.substring(0, front)}...${address.substring(address.length - back)}`;
};

export const RewardsOverview = ({ state, loading }: RewardsOverviewProps) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rewards Overview</CardTitle>
          <CardDescription>Global rewards system statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          <CardTitle>Rewards Overview</CardTitle>
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
      <CardHeader>
        <CardTitle>Rewards Overview</CardTitle>
        <CardDescription>Global rewards system statistics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Total Emission Rate</p>
              <p className="text-2xl font-semibold">{emissionPerDay} {emissionPerDay !== "?" && "points/day"}</p>
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
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <Coins className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Reward Token</p>
              <p className="text-lg font-semibold">{state.rewardTokenSymbol || "?"}</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {state.rewardToken ? truncateTokenAddress(state.rewardToken) : "?"}
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Last Update</p>
              <p className="text-lg font-semibold">
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

