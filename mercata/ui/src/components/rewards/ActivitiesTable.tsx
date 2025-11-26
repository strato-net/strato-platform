import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { formatEmissionRatePerDay, formatEmissionRatePerWeek } from "@/services/rewardsService";
import { formatDistanceToNow } from "date-fns";

interface ActivitiesTableProps {
  activities: Activity[];
  loading: boolean;
  onActivityClick?: (activity: Activity) => void;
}

const ActivityTableContent = ({ 
  activities, 
  onActivityClick 
}: { 
  activities: Activity[]; 
  onActivityClick?: (activity: Activity) => void;
}) => {
  if (activities.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
          No activities found
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
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
              <div>
                <div className="font-medium">{emissionPerDay} CATA/day</div>
                <div className="text-xs text-muted-foreground">{emissionPerWeek} CATA/week</div>
              </div>
            </TableCell>
            <TableCell>{totalStakeFormatted}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{timeAgo}</TableCell>
          </TableRow>
        );
      })}
    </>
  );
};

export const ActivitiesTable = ({ activities, loading, onActivityClick }: ActivitiesTableProps) => {
  const positionActivities = activities.filter((a) => a.activityType === 0);
  const oneTimeActivities = activities.filter((a) => a.activityType === 1);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activities</CardTitle>
        <CardDescription>All reward activities in the system</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="positions" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="positions">Position Activities</TabsTrigger>
            <TabsTrigger value="one-time">One-Time Activities</TabsTrigger>
          </TabsList>
          
          <TabsContent value="positions">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Emission Rate</TableHead>
                    <TableHead>Total Stake</TableHead>
                    <TableHead>Last Update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ActivityTableContent 
                    activities={positionActivities} 
                    onActivityClick={onActivityClick}
                  />
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="one-time">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Emission Rate</TableHead>
                    <TableHead>Total Stake</TableHead>
                    <TableHead>Last Update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ActivityTableContent 
                    activities={oneTimeActivities} 
                    onActivityClick={onActivityClick}
                  />
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

