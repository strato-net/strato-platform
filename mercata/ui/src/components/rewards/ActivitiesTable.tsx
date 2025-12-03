import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek, roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import { formatDistanceToNow } from "date-fns";

interface ActivitiesTableProps {
  activities: Activity[];
  loading: boolean;
}

export const ActivitiesTable = ({ activities, loading }: ActivitiesTableProps) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activities</CardTitle>
          <CardDescription>My reward activities</CardDescription>
        </CardHeader>
        <CardContent>
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
        <CardHeader>
          <CardTitle>Activities</CardTitle>
          <CardDescription>My reward activities</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No activities found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activities</CardTitle>
        <CardDescription>My reward activities</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Emission Rate</TableHead>
                <TableHead>Total Stake</TableHead>
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
                    <TableCell className="font-medium">{activity?.name || "?"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {activity?.activityType !== undefined && activity?.activityType !== null
                          ? (activity.activityType === 0 ? "Position" : "One-Time")
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

