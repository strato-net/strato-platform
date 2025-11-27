import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LeaderboardEntry } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { Trophy, Medal, Award } from "lucide-react";

interface RewardsLeaderboardProps {
  entries: LeaderboardEntry[];
  loading: boolean;
}

const getRankIcon = (rank: number) => {
  if (rank === 1) {
    return <Trophy className="h-5 w-5 text-yellow-500" />;
  } else if (rank === 2) {
    return <Medal className="h-5 w-5 text-gray-400" />;
  } else if (rank === 3) {
    return <Award className="h-5 w-5 text-amber-600" />;
  }
  return null;
};

const truncateAddress = (address: string, front: number = 6, back: number = 4) => {
  if (!address) return "";
  if (address.length <= front + back) return address;
  return `${address.substring(0, front)}...${address.substring(address.length - back)}`;
};

export const RewardsLeaderboard = ({ entries, loading }: RewardsLeaderboardProps) => {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Reward Earners</CardTitle>
          <CardDescription>Leaderboard of users with the highest total rewards</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Reward Earners</CardTitle>
          <CardDescription>Leaderboard of users with the highest total rewards</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">No leaderboard data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Reward Earners</CardTitle>
        <CardDescription>Leaderboard of users with the highest total rewards</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Unclaimed Rewards</TableHead>
                <TableHead className="text-right">Pending Rewards</TableHead>
                <TableHead className="text-right">Total Rewards</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, index) => {
                const rank = index + 1;
                const unclaimedFormatted = formatBalance(entry.unclaimedRewards, "points", 18, 2, 6);
                const pendingFormatted = formatBalance(entry.pendingRewards, "points", 18, 2, 6);
                const totalRewards = BigInt(entry.unclaimedRewards) + BigInt(entry.pendingRewards);
                const totalFormatted = formatBalance(totalRewards.toString(), "points", 18, 2, 6);

                return (
                  <TableRow key={entry.address}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getRankIcon(rank)}
                        <span className="font-semibold">{rank}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{truncateAddress(entry.address)}</span>
                    </TableCell>
                    <TableCell className="text-right font-medium">{unclaimedFormatted}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{pendingFormatted}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={rank <= 3 ? "default" : "secondary"} className="font-semibold">
                        {totalFormatted}
                      </Badge>
                    </TableCell>
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

