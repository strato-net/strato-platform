import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trophy, Medal, Award } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { LeaderboardEntry, formatEmissionRatePerDay, formatEmissionRatePerWeek, formatRoundedWithCommas, roundByMagnitude } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import CopyButton from "@/components/ui/copy";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

interface LeaderboardTableProps {
  entries?: LeaderboardEntry[];
  total?: number;
  limit?: number;
  currentPage?: number;
  loading?: boolean;
  onSortChange?: (sortBy: "rewards" | "emissionRate") => void;
  onPageChange?: (page: number) => void;
}

export const LeaderboardTable = ({ 
  entries = [], 
  total = 0, 
  limit = 10, 
  currentPage = 1, 
  loading = false, 
  onSortChange,
  onPageChange 
}: LeaderboardTableProps) => {
  const [rankByEmissionRate, setRankByEmissionRate] = useState(false);

  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  const startEntry = total > 0 ? (currentPage - 1) * limit + 1 : 0;
  const endEntry = total > 0 ? Math.min(currentPage * limit, total) : 0;
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [1];
    if (currentPage > 3) pages.push("ellipsis-start");
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push("ellipsis-end");
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (onSortChange) {
      onSortChange(rankByEmissionRate ? "emissionRate" : "rewards");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankByEmissionRate]);

  const handlePaginationClick = useCallback((e: React.MouseEvent, page: number) => {
    e.preventDefault();
    if (onPageChange && !loading && page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  }, [onPageChange, loading, totalPages]);

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
    if (rank === 3) return <Award className="h-5 w-5 text-amber-600" />;
    return null;
  };

  const formatPoints = (pointsStr: string) => {
    const points = formatBalance(pointsStr, "points", 18, 18, 18);
    const numeric = points.replace(/\s*points?\s*$/i, '').trim();
    return formatRoundedWithCommas(roundByMagnitude(numeric)) + " points";
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
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No leaderboard data available
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => {
                  const isTopThree = entry.rank <= 3;
                  const emissionPerDay = formatEmissionRatePerDay(entry.emissionRate);
                  const emissionPerWeek = formatEmissionRatePerWeek(entry.emissionRate);
                  return (
                    <TableRow key={entry.address}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getRankIcon(entry.rank)}
                          <span className="font-medium">{entry.rank}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2">
                          <span>{entry.address.slice(0, 6)}...{entry.address.slice(-4)}</span>
                          <CopyButton address={entry.address} />
                        </div>
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
                              {emissionPerDay} {emissionPerDay !== "?" && "points/day"}
                            </span>
                            {emissionPerWeek !== "?" && (
                              <span className="text-xs opacity-90">
                                {emissionPerWeek} points/week
                              </span>
                            )}
                          </div>
                        </Badge>
                      </TableCell>
                      <TableCell>{formatPoints(entry.unclaimedRewards)}</TableCell>
                      <TableCell>{formatPoints(entry.pendingRewards)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between mt-4 px-2 gap-4">
            <div className="text-sm text-muted-foreground">
              {startEntry}-{endEntry} of {total} entries
            </div>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => hasPrevPage && handlePaginationClick(e, currentPage - 1)}
                    className={!hasPrevPage || loading ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                {pageNumbers.map((page, index) => (
                  <PaginationItem key={index}>
                    {page === "ellipsis-start" || page === "ellipsis-end" ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationLink
                        href="#"
                        onClick={(e) => handlePaginationClick(e, page as number)}
                        isActive={currentPage === page}
                        className={loading ? "pointer-events-none opacity-50" : ""}
                      >
                        {page}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => hasNextPage && handlePaginationClick(e, currentPage + 1)}
                    className={!hasNextPage || loading ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

