import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, Award, User } from "lucide-react";
import { LeaderboardEntry, formatRoundedWithCommas, roundByMagnitude } from "@/services/rewardsService";
import { formatBalance } from "@/utils/numberUtils";
import CopyButton from "@/components/ui/copy";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { useUser } from "@/context/UserContext";
import { useIsMobile } from "@/hooks/use-mobile";

interface LeaderboardTableProps {
  entries?: LeaderboardEntry[];
  total?: number;
  limit?: number;
  currentPage?: number;
  loading?: boolean;
  onPageChange?: (page: number) => void;
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
  onPageChange
}: LeaderboardTableProps) => {
  const { userAddress } = useUser();
  const isMobile = useIsMobile();
  
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
        <CardHeader className="px-3 md:px-6">
          <CardTitle>Top Reward Earners</CardTitle>
          <CardDescription>Leaderboard ranked by highest total rewards</CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-6">
          <div className="space-y-2 px-3 md:px-0">
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
        <CardHeader className="px-3 md:px-6">
          <CardTitle>Top Reward Earners</CardTitle>
          <CardDescription>Leaderboard ranked by highest total rewards</CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-6">
          <div className="rounded-none md:rounded-md border-x-0 md:border-x border border-border overflow-hidden">
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

