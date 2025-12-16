import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, Award, User } from "lucide-react";
import { LeaderboardEntry, formatRoundedWithCommas, roundByMagnitude } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import CopyButton from "@/components/ui/copy";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { useUser } from "@/context/UserContext";
import { useIsMobile } from "@/hooks/use-mobile";

interface LeaderboardTableProps {
  entries?: LeaderboardEntry[];
  total?: number;
  limit?: number;
  currentPage?: number;
  loading?: boolean;
  onPageChange?: (page: number) => void;
  timeFilter?: "season" | "all-time";
  onTimeFilterChange?: (filter: "season" | "all-time") => void;
}

const RANK_ICONS: Record<number, { Icon: typeof Trophy; className: string }> = {
  1: { Icon: Trophy, className: "h-5 w-5 text-yellow-500" },
  2: { Icon: Medal, className: "h-5 w-5 text-gray-400" },
  3: { Icon: Award, className: "h-5 w-5 text-amber-600" },
};

const formatPoints = (pointsStr: string) => {
  const numeric = formatBalance(pointsStr, "points", 18, 18, 18).replace(/\s*points?\s*$/i, '').trim();
  return formatRoundedWithCommas(roundByMagnitude(numeric)) + " points";
};

export const LeaderboardTable = ({ 
  entries = [], 
  total = 0, 
  limit = 10, 
  currentPage = 1, 
  loading = false, 
  onPageChange,
  timeFilter: externalTimeFilter,
  onTimeFilterChange
}: LeaderboardTableProps) => {
  const { userAddress } = useUser();
  const isMobile = useIsMobile();
  const [internalTimeFilter, setInternalTimeFilter] = useState<"season" | "all-time">("all-time");
  
  // Use external filter if provided, otherwise use internal state
  const timeFilter = externalTimeFilter ?? internalTimeFilter;
  const setTimeFilter = onTimeFilterChange ?? setInternalTimeFilter;
  
  const columns: ColumnsType<LeaderboardEntry> = useMemo(() => [
    {
      title: "Rank",
      key: "rank",
      dataIndex: "rank",
      render: (rank: number) => {
        const icon = RANK_ICONS[rank];
        return (
          <div className="flex items-center gap-2">
            {icon && <icon.Icon className={icon.className} />}
            <span className="font-medium">{rank}</span>
          </div>
        );
      },
    },
    {
      title: "User Address",
      key: "address",
      dataIndex: "address",
      render: (address: string) => {
        const isCurrentUser = userAddress && address.toLowerCase() === userAddress.toLowerCase();
        return (
          <div className="flex items-center gap-2 font-mono text-sm">
            <span>{address.slice(0, 6)}...{address.slice(-4)}</span>
            <CopyButton address={address} />
            {isCurrentUser && (
              <Badge variant="default" className="ml-1 bg-blue-500 hover:bg-blue-600 text-white">
                <User className="h-3 w-3 mr-1 inline" />
                You
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      title: "Total Rewards Earned",
      key: "totalRewardsEarned",
      dataIndex: "totalRewardsEarned",
      render: formatPoints,
    },
  ], [userAddress]);


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
    <div className="ant-table-themed">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>Top Reward Earners</CardTitle>
            <CardDescription>Leaderboard ranked by highest total rewards</CardDescription>
            </div>
            <div className="inline-flex items-center rounded-full bg-muted p-1">
              <button
                onClick={() => setTimeFilter("all-time")}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
                  timeFilter === "all-time"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All Time
              </button>
              <button
                onClick={() => setTimeFilter("season")}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 ${
                  timeFilter === "season"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Season
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <Table
              columns={columns}
              dataSource={entries}
              rowKey="address"
              loading={loading}
              scroll={isMobile ? { x: 'max-content' } : undefined}
              pagination={{
                current: currentPage,
                pageSize: limit,
                total: total,
                showSizeChanger: false,
                showTotal: isMobile ? undefined : (total, range) => `${range[0]}-${range[1]} of ${total} entries`,
                onChange: (page) => {
                  if (onPageChange && !loading) {
                    onPageChange(page);
                  }
                },
                className: "mt-4",
                simple: isMobile,
              }}
              locale={{
                emptyText: (
                  <div className="text-center text-muted-foreground py-8">
                    No leaderboard data available
                  </div>
                ),
              }}
              className="[&_.ant-table-thead>tr>th]:font-semibold"
              rowClassName={(record: LeaderboardEntry) => 
                userAddress && record.address.toLowerCase() === userAddress.toLowerCase() 
                  ? "highlight-row" 
                  : ""
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

