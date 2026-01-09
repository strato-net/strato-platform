import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw, Coins, Home, Shield, Loader2 } from 'lucide-react';
import { activityFeedApi, ActivityItem } from '@/lib/activityFeed';
import { useUser } from '@/context/UserContext';
import { formatHash } from '@/utils/numberUtils';

const PAGE_SIZE = 10;

const activityTypeConfig: Record<string, { icon: React.ElementType; color: string; bgColor: string }> = {
  deposit: { icon: ArrowDownToLine, color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  withdraw: { icon: ArrowUpFromLine, color: 'text-red-600', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  swap: { icon: Home, color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  bridge: { icon: Home, color: 'text-purple-600', bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
  borrow: { icon: Coins, color: 'text-orange-600', bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  repay: { icon: RefreshCw, color: 'text-teal-600', bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  collateral: { icon: Shield, color: 'text-indigo-600', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  cdp: { icon: Shield, color: 'text-violet-600', bgColor: 'bg-violet-100 dark:bg-violet-900/30' },
  mint: { icon: Coins, color: 'text-amber-600', bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  burn: { icon: Coins, color: 'text-rose-600', bgColor: 'bg-rose-100 dark:bg-rose-900/30' },
  stake: { icon: ArrowDownToLine, color: 'text-emerald-600', bgColor: 'bg-emerald-100 dark:bg-emerald-900/30' },
  redeem: { icon: ArrowUpFromLine, color: 'text-cyan-600', bgColor: 'bg-cyan-100 dark:bg-cyan-900/30' },
  rewards: { icon: Coins, color: 'text-yellow-600', bgColor: 'bg-yellow-100 dark:bg-yellow-900/30' },
  liquidity: { icon: RefreshCw, color: 'text-sky-600', bgColor: 'bg-sky-100 dark:bg-sky-900/30' },
  liquidation: { icon: Shield, color: 'text-red-600', bgColor: 'bg-red-100 dark:bg-red-900/30' },
};

const formatDate = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + 
    ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const AllActivityList = () => {
  const { userAddress } = useUser();
  const isLoggedIn = !!userAddress;
  
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchActivities = useCallback(async () => {
    if (!isLoggedIn) return;
    
    setIsLoading(true);
    try {
      const response = await activityFeedApi.getActivities({
        my: false, // All activities, not just current user
        type: typeFilter === 'all' ? undefined : typeFilter,
        limit: PAGE_SIZE,
        offset: (currentPage - 1) * PAGE_SIZE,
      });
      setActivities(response.activities);
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isLoggedIn, typeFilter, currentPage]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (!isLoggedIn) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Please log in to view activities
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Activity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdraw">Withdraw</SelectItem>
            <SelectItem value="swap">Swap</SelectItem>
            <SelectItem value="borrow">Borrow</SelectItem>
            <SelectItem value="repay">Repay</SelectItem>
            <SelectItem value="stake">Stake</SelectItem>
            <SelectItem value="rewards">Rewards</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Activity Cards */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No activities found
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => {
            const config = activityTypeConfig[activity.type] || activityTypeConfig.deposit;
            const Icon = config.icon;
            const isPositive = ['deposit', 'stake', 'rewards'].includes(activity.type);

            return (
              <Card key={activity.id} className="border">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl ${config.bgColor}`}>
                      <Icon className={`h-5 w-5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-base truncate">{activity.title}</p>
                          <p className="text-sm text-muted-foreground truncate">{activity.description}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`font-medium text-base ${isPositive ? 'text-green-600' : 'text-foreground'}`}>
                            {isPositive ? '+' : ''}{activity.amount} {activity.token}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <Badge variant="outline" className="text-xs">
                          {formatHash(activity.fromAddress)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(activity.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination className="mt-6">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    onClick={() => setCurrentPage(pageNum)}
                    isActive={currentPage === pageNum}
                    className="cursor-pointer"
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};

export default AllActivityList;

