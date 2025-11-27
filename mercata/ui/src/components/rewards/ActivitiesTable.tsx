import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek } from "@/services/rewardsService";
import { formatDistanceToNow } from "date-fns";

interface ActivitiesTableProps {
  activities: Activity[];
  loading: boolean;
  onActivityClick?: (activity: Activity) => void;
}

export const ActivitiesTable = ({ activities, loading, onActivityClick }: ActivitiesTableProps) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activities</CardTitle>
          <CardDescription>All reward activities in the system</CardDescription>
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
          <CardDescription>All reward activities in the system</CardDescription>
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
        <CardDescription>All reward activities in the system</CardDescription>
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
                const emissionPerDay = formatEmissionRatePerDay(activity.emissionRate);
                const emissionPerWeek = formatEmissionRatePerWeek(activity.emissionRate);
                const totalStakeFormatted = formatBalance(activity.totalStake, "", 18, 2, 6);
                const lastUpdate = new Date(Number(activity.lastUpdateTime) * 1000);
                const timeAgo = formatDistanceToNow(lastUpdate, { addSuffix: true });

                return (
                  <TableRow
                    key={activity.activityId}
                    className={onActivityClick ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => onActivityClick?.(activity)}
                  >
                    <TableCell className="font-mono font-medium">{activity.activityId}</TableCell>
                    <TableCell className="font-medium">{activity.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {activity.activityType === 0 ? "Position" : "One-Time"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{emissionPerDay} points/day</div>
                        <div className="text-xs text-muted-foreground">{emissionPerWeek} points/week</div>
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

