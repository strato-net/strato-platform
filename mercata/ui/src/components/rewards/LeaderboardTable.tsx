import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trophy, Medal,Award } from "lucide-react";
import { useState } from "react";

interface LeaderboardEntry {
  rank: number;
  address: string;
  emissionRate: number; // points per day
  unclaimedRewards: number;
  pendingRewards: number;
}

interface LeaderboardTableProps {
  entries?: LeaderboardEntry[];
  loading?: boolean;
}

const truncateAddress = (address: string, front: number = 6, back: number = 4): string => {
  if (!address || address.length <= front + back) return address;
  return `${address.substring(0, front)}...${address.substring(address.length - back)}`;
};

const formatPoints = (points: number): string => {
  return points.toFixed(2);
};

const formatEmissionRate = (rate: number): { perDay: string; perWeek: string } => {
  const perDay = rate.toFixed(0);
  const perWeek = (rate * 7).toFixed(0);
  return { perDay, perWeek };
};

// Dummy data matching the image (emission rates in points per day)
const dummyData: LeaderboardEntry[] = [
  { rank: 1, address: "0x1234567890123456789012345678901234567890", emissionRate: 4320, unclaimedRewards: 5.00, pendingRewards: 2.50 },
  { rank: 2, address: "0x2345678901234567890123456789012345678901", emissionRate: 3888, unclaimedRewards: 4.00, pendingRewards: 3.00 },
  { rank: 3, address: "0x3456789012345678901234567890123456789012", emissionRate: 3456, unclaimedRewards: 3.50, pendingRewards: 2.00 },
  { rank: 4, address: "0x4567890123456789012345678901234567890123", emissionRate: 3024, unclaimedRewards: 3.00, pendingRewards: 2.50 },
  { rank: 5, address: "0x5678901234567890123456789012345678901234", emissionRate: 2880, unclaimedRewards: 2.50, pendingRewards: 2.00 },
  { rank: 6, address: "0x6789012345678901234567890123456789012345", emissionRate: 2592, unclaimedRewards: 2.00, pendingRewards: 1.50 },
  { rank: 7, address: "0x7890123456789012345678901234567890123456", emissionRate: 2304, unclaimedRewards: 1.80, pendingRewards: 1.20 },
  { rank: 8, address: "0x8901234567890123456789012345678901234567", emissionRate: 2160, unclaimedRewards: 1.50, pendingRewards: 1.00 },
  { rank: 9, address: "0x9012345678901234567890123456789012345678", emissionRate: 2016, unclaimedRewards: 1.20, pendingRewards: 0.80 },
  { rank: 10, address: "0xa012345678901234567890123456789012345678", emissionRate: 1872, unclaimedRewards: 1.00, pendingRewards: 0.50 },
];

export const LeaderboardTable = ({ entries, loading = false }: LeaderboardTableProps) => {
  const [rankByEmissionRate, setRankByEmissionRate] = useState(false);

  // Use dummy data if no entries provided
  const data = entries || dummyData;

  // Sort data based on toggle
  const sortedData = [...data].sort((a, b) => {
    if (rankByEmissionRate) {
      return b.emissionRate - a.emissionRate;
    }
    // Sort by total rewards (unclaimed + pending)
    const totalA = a.unclaimedRewards + a.pendingRewards;
    const totalB = b.unclaimedRewards + b.pendingRewards;
    return totalB - totalA;
  });

  // Reassign ranks after sorting
  const rankedData = sortedData.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));

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

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Reward Earners</CardTitle>
          <CardDescription>Leaderboard ranked by highest total rewards</CardDescription>
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
            <Label htmlFor="emission-rate-toggle" className="text-sm font-normal cursor-pointer">
              Rank by Emission Rate
            </Label>
            <Switch
              id="emission-rate-toggle"
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
                <TableHead>Rank</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Emission Rate</TableHead>
                <TableHead>Unclaimed Rewards</TableHead>
                <TableHead>Pending Rewards</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankedData.map((entry) => {
                const isTopThree = entry.rank <= 3;
                const emissionRateFormatted = formatEmissionRate(entry.emissionRate);
                return (
                  <TableRow key={entry.address}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getRankIcon(entry.rank)}
                        <span className="font-medium">{entry.rank}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {truncateAddress(entry.address)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={isTopThree ? "default" : "secondary"}
                        className={
                          isTopThree
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                        }
                      >
                        <div className="flex flex-col items-start">
                          <span className="font-medium">
                            {emissionRateFormatted.perDay} points/day
                          </span>
                          <span className="text-xs opacity-90">
                            {emissionRateFormatted.perWeek} points/week
                          </span>
                        </div>
                      </Badge>
                    </TableCell>
                    <TableCell>{formatPoints(entry.unclaimedRewards)} points</TableCell>
                    <TableCell>{formatPoints(entry.pendingRewards)} points</TableCell>
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

