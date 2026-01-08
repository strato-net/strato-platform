import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { RefreshCw, ExternalLink, Shield, ArrowUpRight, ArrowDownLeft, Home, Loader2 } from "lucide-react";
import { activityFeedApi, ActivityItem } from "@/lib/activityFeed";
import { useUser } from "@/context/UserContext";

const PAGE_SIZE = 10;

// Format address for display
const formatAddress = (address: string) => {
  if (!address) return "N/A";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// Icon configs by activity type - matching Lovable design
const activityTypeConfig: Record<string, { icon: React.ReactNode; bgColor: string; iconColor: string }> = {
  deposit: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-emerald-100 dark:bg-emerald-900/30", iconColor: "text-emerald-500 dark:text-emerald-400" },
  withdraw: { icon: <ArrowDownLeft className="h-5 w-5" />, bgColor: "bg-red-100 dark:bg-red-900/30", iconColor: "text-red-500 dark:text-red-400" },
  borrow: { icon: <ArrowUpRight className="h-5 w-5" />, bgColor: "bg-amber-100 dark:bg-amber-900/30", iconColor: "text-amber-500 dark:text-amber-400" },
  repay: { icon: <ArrowDownLeft className="h-5 w-5" />, bgColor: "bg-green-100 dark:bg-green-900/30", iconColor: "text-green-500 dark:text-green-400" },
  swap: { icon: <Home className="h-5 w-5" />, bgColor: "bg-sky-100 dark:bg-sky-900/30", iconColor: "text-sky-500 dark:text-sky-400" },
  bridge: { icon: <Home className="h-5 w-5" />, bgColor: "bg-blue-100 dark:bg-blue-900/30", iconColor: "text-blue-500 dark:text-blue-400" },
  stake: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-purple-100 dark:bg-purple-900/30", iconColor: "text-purple-500 dark:text-purple-400" },
  unstake: { icon: <ArrowDownLeft className="h-5 w-5" />, bgColor: "bg-purple-100 dark:bg-purple-900/30", iconColor: "text-purple-500 dark:text-purple-400" },
  rewards: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-yellow-100 dark:bg-yellow-900/30", iconColor: "text-yellow-500 dark:text-yellow-400" },
  liquidity: { icon: <Home className="h-5 w-5" />, bgColor: "bg-indigo-100 dark:bg-indigo-900/30", iconColor: "text-indigo-500 dark:text-indigo-400" },
  liquidation: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-red-100 dark:bg-red-900/30", iconColor: "text-red-500 dark:text-red-400" },
  other: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-gray-100 dark:bg-gray-900/30", iconColor: "text-gray-500 dark:text-gray-400" },
};

const typeFilterOptions = [
  { value: "all", label: "All types" },
  { value: "deposit", label: "Deposit" },
  { value: "withdraw", label: "Withdraw" },
  { value: "borrow", label: "Borrow" },
  { value: "swap", label: "Swap" },
  { value: "bridge", label: "Bridge" },
  { value: "stake", label: "Stake" },
];

const timeFilterOptions = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

const MyActivityList = () => {
  const { userAddress, isLoggedIn } = useUser();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const fetchActivities = useCallback(async () => {
    if (!isLoggedIn || !userAddress) {
      setActivities([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    try {
      const response = await activityFeedApi.getActivities({
        userAddress,
        type: typeFilter !== "all" ? typeFilter : undefined,
        limit: PAGE_SIZE,
        offset: (currentPage - 1) * PAGE_SIZE,
      });
      
      // Apply time filter on frontend
      let filtered = response.activities;
      if (timeFilter !== "all") {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfDay);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        filtered = filtered.filter((a) => {
          const activityDate = new Date(a.timestamp);
          switch (timeFilter) {
            case "today": return activityDate >= startOfDay;
            case "week": return activityDate >= startOfWeek;
            case "month": return activityDate >= startOfMonth;
            default: return true;
          }
        });
      }
      
      setActivities(filtered);
      setTotal(response.total);
    } catch (error) {
      console.error("Failed to fetch activities:", error);
      setActivities([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [isLoggedIn, userAddress, typeFilter, timeFilter, currentPage]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, timeFilter]);

  const formatDate = (timestamp: string) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    }) + " · " + date.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  };

  const getConfig = (type: string) => activityTypeConfig[type] || activityTypeConfig.other;

  // Pagination items logic - same as ActivityFeedList
  const paginationItems = useMemo(() => {
    if (totalPages <= 1) return [];
    
    const pages: Array<{ type: string; number?: number }> = [];
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    const maxVisiblePages = isMobile ? 3 : 7;
    const halfVisible = Math.floor(maxVisiblePages / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, currentPage + halfVisible);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
      if (startPage === 1) {
        endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      } else {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
    }
    
    if (startPage > 1) {
      pages.push({ type: 'page', number: 1 });
      if (startPage > 2) {
        pages.push({ type: 'ellipsis' });
      }
    }
    
    for (let i = startPage; i <= endPage; i++) {
      pages.push({ type: 'page', number: i });
    }
    
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push({ type: 'ellipsis' });
      }
      pages.push({ type: 'page', number: totalPages });
    }
    
    return pages;
  }, [currentPage, totalPages]);

  if (!isLoggedIn) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Please log in to view your activities
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      {/* Filters - matching Lovable design */}
      <div className="flex items-center gap-3 mb-6">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px] h-10">
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} onClick={(e) => { e.stopPropagation(); fetchActivities(); }} />
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            {typeFilterOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-[130px] h-10">
            <SelectValue placeholder="All time" />
          </SelectTrigger>
          <SelectContent>
            {timeFilterOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Activity List */}
      <div className="space-y-3">
        {isLoading ? (
          <Card>
            <CardContent className="p-6 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : activities.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No activities found
            </CardContent>
          </Card>
        ) : (
          activities.map((activity) => {
            const config = getConfig(activity.type);
            const isPositive = !activity.type.includes("withdraw") && activity.type !== "repay";
            return (
              <Card key={activity.id} className="hover:shadow-md transition-shadow border">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${config.bgColor} ${config.iconColor}`}>
                      {config.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">{activity.title}</h3>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className={`font-semibold text-sm sm:text-base whitespace-nowrap ${isPositive ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                            {isPositive ? "+" : "-"}{activity.amount} {activity.token}
                          </span>
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">{activity.description}</p>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        {activity.fromAddress && (
                          <p className="text-xs sm:text-sm">
                            <span className="text-muted-foreground">From </span>
                            <span className="text-amber-500 dark:text-amber-400 font-medium">{formatAddress(activity.fromAddress)}</span>
                          </p>
                        )}
                        <p className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">{formatDate(activity.timestamp)}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Pagination - same style as ActivityFeedList */}
      {totalPages > 1 && (
        <div className="mt-6 sm:mt-8 pb-12 sm:pb-0">
          <Pagination>
            <PaginationContent className="flex flex-wrap sm:flex-nowrap justify-center gap-0 sm:gap-1">
              <PaginationItem>
                <PaginationPrevious 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className={currentPage === 1 || isLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              
              {paginationItems.map((item, index) => {
                if (item.type === 'ellipsis') {
                  return (
                    <PaginationItem key={`ellipsis-${index}`} className="hidden sm:flex">
                      <span className="px-3 py-2 text-sm text-muted-foreground">...</span>
                    </PaginationItem>
                  );
                }
                
                return (
                  <PaginationItem key={item.number}>
                    <PaginationLink
                      onClick={() => setCurrentPage(item.number!)}
                      isActive={currentPage === item.number}
                      className={`cursor-pointer px-2 sm:px-3 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {item.number}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              
              <PaginationItem>
                <PaginationNext 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className={currentPage === totalPages || isLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};

export default MyActivityList;
