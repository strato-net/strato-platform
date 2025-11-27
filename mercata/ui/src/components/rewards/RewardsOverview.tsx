import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RewardsState } from "@/services/rewardsService";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek } from "@/services/rewardsService";
import { Coins, Zap, Clock } from "lucide-react";

interface RewardsOverviewProps {
  state: RewardsState | null;
  loading: boolean;
}

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

  const emissionPerDay = formatEmissionRatePerDay(state.totalRewardsEmission);
  const emissionPerWeek = formatEmissionRatePerWeek(state.totalRewardsEmission);

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
              <p className="text-2xl font-semibold">{emissionPerDay} points/day</p>
              <p className="text-xs text-muted-foreground mt-1">{emissionPerWeek} points/week</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <Coins className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Reward Token</p>
              <p className="text-lg font-semibold">Points</p>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {state.rewardToken.slice(0, 10)}...
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Last Update</p>
              <p className="text-lg font-semibold">Block {state.lastBlockHandled}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {state.activityIds.length} {state.activityIds.length === 1 ? "activity" : "activities"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

