import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, ExternalLink, Shield, ArrowUpRight, Home, ArrowDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// Activity types
type ActivityType = "deposit" | "withdraw" | "borrow" | "swap" | "bridge" | "cdp";

interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  fromAddress?: string;
  fromLabel?: string;
  toLabel?: string;
  amount: string;
  amountToken: string;
  isPositive: boolean;
  timestamp: Date;
}

// Dummy data for demonstration
const dummyActivities: Activity[] = [
  {
    id: "1",
    type: "deposit",
    title: "Deposit USDC to Savings",
    description: "Deposited 10.00 USDC",
    fromAddress: "707723...Af8e",
    amount: "+10",
    amountToken: "USDST",
    isPositive: true,
    timestamp: new Date("2025-12-29T15:45:00"),
  },
  {
    id: "2",
    type: "borrow",
    title: "Borrow USDST",
    description: "Added collateral 1.50 ETHST",
    fromAddress: "798767...9baF",
    amount: "+1.50",
    amountToken: "ETHST",
    isPositive: true,
    timestamp: new Date("2025-12-28T14:30:00"),
  },
  {
    id: "3",
    type: "cdp",
    title: "CDP Mint",
    description: "Added collateral 2.50 GOLDST",
    fromAddress: "7c07...97Fb",
    amount: "+2,500",
    amountToken: "USDST",
    isPositive: true,
    timestamp: new Date("2025-12-27T11:15:00"),
  },
  {
    id: "4",
    type: "swap",
    title: "Swap GOLDST to SILVST",
    description: "Swapped 2.50 GO.DST",
    amount: "+1,250",
    amountToken: "SILVST",
    isPositive: true,
    timestamp: new Date("2025-12-26T09:00:00"),
  },
  {
    id: "5",
    type: "bridge",
    title: "Bridge In",
    description: "Bridged 0.75 ETHST",
    fromLabel: "Ethereum",
    amount: "+0.75",
    amountToken: "ETHST",
    isPositive: true,
    timestamp: new Date("2025-12-25T18:20:00"),
  },
  {
    id: "6",
    type: "withdraw",
    title: "Withdraw USDC",
    description: "To Ethereum",
    toLabel: "Ethereum",
    amount: "-500",
    amountToken: "USDC",
    isPositive: false,
    timestamp: new Date("2025-12-24T16:10:00"),
  },
];

const activityTypeConfig: Record<ActivityType, { icon: React.ReactNode; bgColor: string; iconColor: string }> = {
  deposit: {
    icon: <Shield className="h-5 w-5" />,
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  withdraw: {
    icon: <ArrowDownLeft className="h-5 w-5" />,
    bgColor: "bg-red-100 dark:bg-red-900/30",
    iconColor: "text-red-500 dark:text-red-400",
  },
  borrow: {
    icon: <ArrowUpRight className="h-5 w-5" />,
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  swap: {
    icon: <Home className="h-5 w-5" />,
    bgColor: "bg-sky-100 dark:bg-sky-900/30",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  bridge: {
    icon: <Home className="h-5 w-5" />,
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  cdp: {
    icon: <Shield className="h-5 w-5" />,
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
    iconColor: "text-yellow-600 dark:text-yellow-500",
  },
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

const MyActivityList = () => {
  const [typeFilter, setTypeFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate refresh
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const filteredActivities = useMemo(() => {
    let filtered = [...dummyActivities];

    // Filter by type
    if (typeFilter !== "all") {
      filtered = filtered.filter((a) => a.type === typeFilter);
    }

    // Filter by time
    if (timeFilter !== "all") {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      filtered = filtered.filter((a) => {
        const activityDate = new Date(a.timestamp);
        switch (timeFilter) {
          case "today":
            return activityDate >= startOfDay;
          case "week":
            return activityDate >= startOfWeek;
          case "month":
            return activityDate >= startOfMonth;
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [typeFilter, timeFilter]);

  const formatDate = (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };
    return date.toLocaleDateString("en-US", options).replace(",", " ·");
  };

  const formatAddress = (address: string) => {
    return address;
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px] h-10">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              {typeFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-[140px] h-10">
            <SelectValue placeholder="All time" />
          </SelectTrigger>
          <SelectContent>
            {timeFilterOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Activity List */}
      <div className="space-y-3">
        {filteredActivities.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No activities found
            </CardContent>
          </Card>
        ) : (
          filteredActivities.map((activity) => {
            const config = activityTypeConfig[activity.type];
            return (
              <Card key={activity.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left side - Icon and details */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Icon */}
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${config.bgColor} ${config.iconColor}`}
                      >
                        {config.icon}
                      </div>

                      {/* Details */}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">
                          {activity.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {activity.description}
                        </p>
                        {activity.fromAddress && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">From </span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium cursor-pointer hover:underline">
                              {formatAddress(activity.fromAddress)}
                            </span>
                          </p>
                        )}
                        {activity.fromLabel && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">From </span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              {activity.fromLabel}
                            </span>
                          </p>
                        )}
                        {activity.toLabel && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">To </span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              {activity.toLabel}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right side - Amount and date */}
                    <div className="flex-shrink-0 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span
                          className={`font-semibold text-sm sm:text-base ${
                            activity.isPositive
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-500 dark:text-red-400"
                          }`}
                        >
                          {activity.amount} {activity.amountToken}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                        {formatDate(activity.timestamp)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

export default MyActivityList;

