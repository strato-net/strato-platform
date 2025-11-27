import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LeaderboardEntry, formatEmissionRatePerDay, formatEmissionRatePerWeek } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import { Trophy, Medal, Award } from "lucide-react";
import { useState, useMemo } from "react";

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
  const [rankByEmissionRate, setRankByEmissionRate] = useState(false);

  // Sort entries based on toggle state
  const sortedEntries = useMemo(() => {
    const sorted = [...entries];
    if (rankByEmissionRate) {
      // Sort by emission rate (descending)
      sorted.sort((a, b) => {
        const rateA = BigInt(a.emissionRate);
        const rateB = BigInt(b.emissionRate);
        if (rateA > rateB) return -1;
        if (rateA < rateB) return 1;
        return 0;
      });
    } else {
      // Sort by total rewards (descending)
      sorted.sort((a, b) => {
        const totalA = BigInt(a.unclaimedRewards) + BigInt(a.pendingRewards);
        const totalB = BigInt(b.unclaimedRewards) + BigInt(b.pendingRewards);
        if (totalA > totalB) return -1;
        if (totalA < totalB) return 1;
        return 0;
      });
    }
    return sorted;
  }, [entries, rankByEmissionRate]);

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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Top Reward Earners</CardTitle>
            <CardDescription>
              {rankByEmissionRate 
                ? "Leaderboard ranked by highest emission rate" 
                : "Leaderboard ranked by highest total rewards"}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="emission-toggle" className="text-sm font-normal cursor-pointer">
              Rank by Emission Rate
            </Label>
            <Switch
              id="emission-toggle"
              checked={rankByEmissionRate}
              onCheckedChange={setRankByEmissionRate}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Rank</TableHead>
                <TableHead>Address</TableHead>
                {rankByEmissionRate ? (
                  <>
                    <TableHead className="text-right">Emission Rate</TableHead>
                    <TableHead className="text-right">Unclaimed Rewards</TableHead>
                    <TableHead className="text-right">Pending Rewards</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="text-right">Unclaimed Rewards</TableHead>
                    <TableHead className="text-right">Pending Rewards</TableHead>
                    <TableHead className="text-right">Total Rewards</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedEntries.map((entry, index) => {
                const rank = index + 1;
                const unclaimedFormatted = formatBalance(entry.unclaimedRewards, "points", 18, 2, 6);
                const pendingFormatted = formatBalance(entry.pendingRewards, "points", 18, 2, 6);
                const totalRewards = BigInt(entry.unclaimedRewards) + BigInt(entry.pendingRewards);
                const totalFormatted = formatBalance(totalRewards.toString(), "points", 18, 2, 6);
                const emissionPerDay = formatEmissionRatePerDay(entry.emissionRate);
                const emissionPerWeek = formatEmissionRatePerWeek(entry.emissionRate);

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
                    {rankByEmissionRate ? (
                      <>
                        <TableCell className="text-right">
                          <Badge variant={rank <= 3 ? "default" : "secondary"} className="font-semibold">
                            <div>
                              <div className="font-medium">{emissionPerDay} points/day</div>
                              <div className="text-xs opacity-80">{emissionPerWeek} points/week</div>
                            </div>
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{unclaimedFormatted}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{pendingFormatted}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right font-medium">{unclaimedFormatted}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{pendingFormatted}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={rank <= 3 ? "default" : "secondary"} className="font-semibold">
                            {totalFormatted}
                          </Badge>
                        </TableCell>
                      </>
                    )}
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

