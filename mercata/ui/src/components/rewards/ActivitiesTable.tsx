import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek, roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import { formatDistanceToNow } from "date-fns";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ActivitiesTableProps {
  activities: Activity[];
  loading: boolean;
}

const truncateActivityName = (name: string, maxLength: number = 30): string => {
  if (!name || name.length <= maxLength) return name;
  return name.substring(0, maxLength) + "...";
};

export const ActivitiesTable = ({ activities, loading }: ActivitiesTableProps) => {
  if (loading) {
    return (
      <Card>
        <CardHeader className="px-3 md:px-6">
          <CardTitle>Activities</CardTitle>
          <CardDescription>All reward activities</CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader className="px-3 md:px-6">
          <CardTitle>Activities</CardTitle>
          <CardDescription>All reward activities</CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <p className="text-muted-foreground text-center py-8">No activities found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="px-3 md:px-6">
        <CardTitle>Activities</CardTitle>
        <CardDescription>All reward activities</CardDescription>
      </CardHeader>
      <CardContent className="px-0 md:px-6 pb-0 md:pb-6">
        <div className="md:rounded-md border-y md:border overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    Emission Rate
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">
                          The rate at which rewards are emitted for this activity (points per second). This is the base emission rate before factoring in your stake.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    Total Stake
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">
                          The total amount staked across all users in this activity. Your share of rewards is proportional to your stake relative to this total.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead>Last Update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((activity) => {
                const emissionRateStr = activity?.emissionRate || null;
                const emissionPerDay = emissionRateStr ? formatEmissionRatePerDay(emissionRateStr) : "?";
                const emissionPerWeek = emissionRateStr ? formatEmissionRatePerWeek(emissionRateStr) : "?";
                // Use totalStake directly (not dollarized since we don't know which assets)
                const totalStakeStr = activity?.totalStake || null;
                const totalStakeDecimal = totalStakeStr ? formatBalance(totalStakeStr, "", 18, 18, 18) : null;
                const totalStakeFormatted = totalStakeDecimal ? formatRoundedWithCommas(roundByMagnitude(totalStakeDecimal)) : "?";
                const lastUpdateTimeStr = activity?.lastUpdateTime || null;
                const lastUpdate = lastUpdateTimeStr ? new Date(Number(lastUpdateTimeStr) * 1000) : null;
                const timeAgo = lastUpdate ? formatDistanceToNow(lastUpdate, { addSuffix: true }) : "?";

                return (
                  <TableRow
                    key={activity?.activityId || Math.random()}
                  >
                    <TableCell className="font-mono font-medium">
                      {activity?.activityId !== undefined && activity?.activityId !== null ? activity.activityId : "?"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {activity?.name ? truncateActivityName(activity.name) : "?"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {activity?.activityType !== undefined && activity?.activityType !== null
                          ? (activity.activityType === 1 ? "One-Time" : "Position")
                          : "?"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {emissionPerDay} {emissionPerDay !== "?" && "points/day"}
                        </div>
                        {emissionPerWeek !== "?" && (
                          <div className="text-xs text-muted-foreground">{emissionPerWeek} points/week</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{totalStakeFormatted}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{timeAgo}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

