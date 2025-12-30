import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, Shield, ArrowUpRight, Home, ArrowDownLeft, Loader2 } from "lucide-react";
import { useActivities } from "@/hooks/useActivities";
import { useUser } from "@/context/UserContext";
import { formatUnits } from "viem";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const activityTypeConfig: Record<string, { icon: React.ReactNode; bgColor: string; iconColor: string }> = {
  deposit: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-emerald-100 dark:bg-emerald-900/30", iconColor: "text-emerald-600 dark:text-emerald-400" },
  withdraw: { icon: <ArrowDownLeft className="h-5 w-5" />, bgColor: "bg-red-100 dark:bg-red-900/30", iconColor: "text-red-500 dark:text-red-400" },
  borrow: { icon: <ArrowUpRight className="h-5 w-5" />, bgColor: "bg-amber-100 dark:bg-amber-900/30", iconColor: "text-amber-600 dark:text-amber-400" },
  swap: { icon: <Home className="h-5 w-5" />, bgColor: "bg-sky-100 dark:bg-sky-900/30", iconColor: "text-sky-600 dark:text-sky-400" },
  bridge: { icon: <Home className="h-5 w-5" />, bgColor: "bg-blue-100 dark:bg-blue-900/30", iconColor: "text-blue-600 dark:text-blue-400" },
  cdp: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-yellow-100 dark:bg-yellow-900/30", iconColor: "text-yellow-600 dark:text-yellow-500" },
  other: { icon: <Shield className="h-5 w-5" />, bgColor: "bg-muted", iconColor: "text-muted-foreground" },
};

const typeFilterOptions = [
  { value: "all", label: "All types" },
  { value: "deposit", label: "Deposit" },
  { value: "withdraw", label: "Withdraw" },
  { value: "borrow", label: "Borrow" },
  { value: "swap", label: "Swap" },
  { value: "bridge", label: "Bridge" },
];

const timeFilterOptions = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

const formatAddress = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
const formatAmount = (amount: string) => {
  try {
    const formatted = formatUnits(BigInt(amount), 18);
    return parseFloat(formatted).toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    return amount;
  }
};
const formatDate = (ts: string) => {
  try {
    const date = new Date(ts.replace(" UTC", "Z").replace(" ", "T"));
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(",", " ·");
  } catch {
    return ts;
  }
};

const MyActivityList = () => {
  const [typeFilter, setTypeFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const { userAddress } = useUser();

  const { activities, loading, refetch, page, setPage, totalPages } = useActivities({
    userAddress: userAddress || undefined,
    type: typeFilter,
    period: timeFilter,
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              {typeFilterOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Select value={timeFilter} onValueChange={(v) => { setTimeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="All time" /></SelectTrigger>
          <SelectContent>
            {timeFilterOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading && activities.length === 0 && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Activity List */}
      <div className="space-y-3">
        {!loading && activities.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">No activities found</CardContent></Card>
        ) : (
          activities.map((activity) => {
            const config = activityTypeConfig[activity.type] || activityTypeConfig.other;
            return (
              <Card key={activity.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${config.bgColor} ${config.iconColor}`}>
                        {config.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">{activity.title}</h3>
                        <p className="text-sm text-muted-foreground">{activity.description}</p>
                        {activity.fromAddress && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">From </span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium">{formatAddress(activity.fromAddress)}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className={`font-semibold text-sm sm:text-base ${activity.isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                          {activity.isPositive ? "+" : "-"}{formatAmount(activity.amount)} {activity.amountToken}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1">{formatDate(activity.timestamp)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => setPage(Math.max(1, page - 1))} className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"} />
              </PaginationItem>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = i + 1;
                return (
                  <PaginationItem key={p}>
                    <PaginationLink onClick={() => setPage(p)} isActive={page === p} className="cursor-pointer">{p}</PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext onClick={() => setPage(Math.min(totalPages, page + 1))} className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};

export default MyActivityList;
