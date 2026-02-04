import { useState, useEffect, useCallback } from "react";
import { activityTypes } from "./activityTypes";
import { activityFeedApi } from "@/lib/activityFeed";
import { useUser } from "@/context/UserContext";
import { Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type { Event } from "@mercata/shared-types";
import { api } from "@/lib/axios";
import { ActivityCard, type ActivityCardData } from "./ActivityCard";

interface ActivityFeedCardsProps {
  isMyActivity: boolean;
}

const ActivityFeedCards = ({ isMyActivity }: ActivityFeedCardsProps) => {
  const { userAddress } = useUser();
  const [cardData, setCardData] = useState<ActivityCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedActivityType, setSelectedActivityType] = useState<string>("all");
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const itemsPerPage = 10;

  const fetchAllActivities = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const offset = (currentPage - 1) * itemsPerPage;

      // Build activity type pairs with filter configs - filter by selected type if not "all"
      let activityTypePairs = Object.entries(activityTypes).map(([key, config]) => ({
        contract_name: config.contract_name,
        event_name: config.event_name,
        filterConfig: config.filterConfig,
      }));

      // Filter by selected activity type if not "all"
      if (selectedActivityType !== "all") {
        const selectedConfig = activityTypes[selectedActivityType];
        if (selectedConfig) {
          activityTypePairs = [{
            contract_name: selectedConfig.contract_name,
            event_name: selectedConfig.event_name,
            filterConfig: selectedConfig.filterConfig,
          }];
        }
      }

      // Use the backend endpoint that handles exact pair matching
      const response = await activityFeedApi.getActivities(activityTypePairs, {
        limit: itemsPerPage,
        offset: offset,
        myActivity: isMyActivity,
        timeRange: selectedTimeRange as 'all' | 'today' | 'week' | 'month',
      });

        // Fetch pool tokens for AddLiquidity events first (needed for token address extraction)
        const poolAddresses = [...new Set(
          response.events
            .filter(event => event.contract_name === "Pool" && event.event_name === "AddLiquidity")
            .map(event => event.address)
        )];
        const poolTokenMap = new Map<string, { tokenA: string; tokenB: string }>();
        if (poolAddresses.length > 0) {
          try {
            const poolPromises = poolAddresses.map(async (poolAddress) => {
              try {
                const res = await api.get(`/swap-pools/${poolAddress}`);
                const pool = Array.isArray(res.data) ? res.data[0] : res.data;
                // Pool response has tokenA and tokenB objects with address property
                let tokenA = pool?.tokenA?.address || pool?.tokenA;
                let tokenB = pool?.tokenB?.address || pool?.tokenB;
                // Normalize addresses to lowercase for consistent lookup
                if (tokenA) tokenA = tokenA.toLowerCase();
                if (tokenB) tokenB = tokenB.toLowerCase();
                if (tokenA && tokenB) {
                  return { poolAddress, tokenA, tokenB };
                }
                return null;
              } catch {
                return null;
              }
            });
            const poolResults = await Promise.all(poolPromises);
            poolResults.forEach(result => {
              if (result) {
                poolTokenMap.set(result.poolAddress, { tokenA: result.tokenA, tokenB: result.tokenB });
              }
            });
          } catch (err) {
            console.warn("Failed to fetch pool tokens:", err);
          }
        }

        // Collect token addresses using getTokenAddress from activity type configs
        const allTokenAddresses = [...new Set(
          response.events
            .flatMap(event => {
              // Find matching activity type
              const matchingType = Object.entries(activityTypes).find(
                ([_, config]) =>
                  config.contract_name === event.contract_name &&
                  config.event_name === event.event_name
              );

              // Extract token addresses using the config's getTokenAddress function
              let addresses: string[] = [];
              if (matchingType && matchingType[1].getTokenAddress) {
                addresses = matchingType[1].getTokenAddress(event);
              }
              
              // For AddLiquidity events, also include tokenA and tokenB from pool info
              if (event.contract_name === "Pool" && event.event_name === "AddLiquidity") {
                const poolTokens = poolTokenMap.get(event.address);
                if (poolTokens) {
                  addresses.push(poolTokens.tokenA, poolTokens.tokenB);
                }
              }
              
              return addresses;
            })
        )];
        const tokenSymbolMap = new Map<string, string>();
        const tokenImageMap = new Map<string, string>();

        if (allTokenAddresses.length > 0) {
          try {
            // Fetch token metadata (symbols and images) in batch
            const tokenPromises = allTokenAddresses.map(async (address) => {
              try {
                const res = await api.get(`/tokens/${address}`);
                const token = Array.isArray(res.data) ? res.data[0] : res.data;
                const symbol = token?._symbol || token?.token?._symbol || "";
                const image = token?.images?.[0]?.value || token?.token?.images?.[0]?.value || "";
                return { address, symbol, image };
              } catch {
                return { address, symbol: "", image: "" };
              }
            });
            const tokenResults = await Promise.all(tokenPromises);
            tokenResults.forEach(({ address, symbol, image }) => {
              // Normalize address to lowercase for consistent lookup
              const normalizedAddress = address.toLowerCase();
              if (symbol) {
                tokenSymbolMap.set(normalizedAddress, symbol);
                tokenSymbolMap.set(address, symbol); // Also store original case for lookup
              }
              if (image) {
                tokenImageMap.set(normalizedAddress, image);
                tokenImageMap.set(address, image); // Also store original case for lookup
              }
            });
          } catch (err) {
            // If fetching token metadata fails, continue without it
            console.warn("Failed to fetch token metadata:", err);
          }
        }

        // Route each event to the appropriate handler
        const allCardData: ActivityCardData[] = [];
        for (const event of response.events) {
          // Find matching activity type by contract_name and event_name
          const matchingType = Object.entries(activityTypes).find(
            ([_, config]) =>
              config.contract_name === event.contract_name &&
              config.event_name === event.event_name
          );

          if (matchingType) {
            const [, config] = matchingType;
            
            // For AddLiquidity events, attach tokenA and tokenB from pool info
            if (event.contract_name === "Pool" && event.event_name === "AddLiquidity") {
              const poolTokens = poolTokenMap.get(event.address);
              if (poolTokens) {
                (event as any).tokenA = poolTokens.tokenA;
                (event as any).tokenB = poolTokens.tokenB;
              }
            }

            // Get token symbols and images using the config's getTokenAddress function
            const tokenSymbolsMap = new Map<string, string>();
            const tokenImagesMap = new Map<string, string>();
            if (config.getTokenAddress) {
              const tokenAddresses = config.getTokenAddress(event);
              // For AddLiquidity, also include tokenA and tokenB if available
              if (event.contract_name === "Pool" && event.event_name === "AddLiquidity") {
                const poolTokens = poolTokenMap.get(event.address);
                if (poolTokens) {
                  tokenAddresses.push(poolTokens.tokenA, poolTokens.tokenB);
                }
              }
              tokenAddresses.forEach(address => {
                // Normalize address to lowercase for lookup
                const normalizedAddress = address.toLowerCase();
                const symbol = tokenSymbolMap.get(normalizedAddress) || tokenSymbolMap.get(address);
                if (symbol) {
                  tokenSymbolsMap.set(address, symbol);
                }
                const image = tokenImageMap.get(normalizedAddress) || tokenImageMap.get(address);
                if (image) {
                  tokenImagesMap.set(address, image);
                }
              });
            }
            const cardData = config.handler(event, tokenSymbolsMap, userAddress, tokenImagesMap);
            // Add iconConfig from the activity type config
            allCardData.push({
              ...cardData,
              iconConfig: config.iconConfig,
            });
          }
        }

      setCardData(allCardData);
      setTotalPages(Math.ceil((response.total || 0) / itemsPerPage));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch activities");
    } finally {
      setLoading(false);
    }
  }, [userAddress, isMyActivity, currentPage, selectedActivityType, selectedTimeRange]);

  useEffect(() => {
    fetchAllActivities();
  }, [fetchAllActivities, refreshKey]);

  // Reset to page 1 when activity type or time range changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedActivityType, selectedTimeRange]);

  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
    setCurrentPage(1); // Reset to first page on refresh
  }, []);

  // Get activity type display names from config, sorted alphabetically
  const activityTypeOptions = [
    { value: "all", label: "All types" },
    ...Object.entries(activityTypes).map(([key, config]) => ({
      value: key,
      label: config.displayName || key,
    })).sort((a, b) => a.label.localeCompare(b.label)),
  ];

  const paginationItems = (() => {
    if (totalPages <= 1) return [];

    const pages = [];
    const isMobile = window.innerWidth < 640;
    const maxVisiblePages = isMobile ? 3 : 7;
    const halfVisible = Math.floor(maxVisiblePages / 2);

    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, currentPage + halfVisible);

    // Adjust if we're near the edges
    if (endPage - startPage + 1 < maxVisiblePages) {
      if (startPage === 1) {
        endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      } else {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
    }

    // Always show first page
    if (startPage > 1) {
      pages.push({ type: 'page', number: 1 });
      if (startPage > 2) {
        pages.push({ type: 'ellipsis' });
      }
    }

    // Show visible pages
    for (let i = startPage; i <= endPage; i++) {
      pages.push({ type: 'page', number: i });
    }

    // Always show last page
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push({ type: 'ellipsis' });
      }
      pages.push({ type: 'page', number: totalPages });
    }

    return pages;
  })();

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-4 mb-4">
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={loading}
          className="h-10 flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>

        <Select value={selectedActivityType} onValueChange={setSelectedActivityType}>
        <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select activity type" />
        </SelectTrigger>
        <SelectContent>
            {activityTypeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
                {option.label}
            </SelectItem>
            ))}
        </SelectContent>
        </Select>

        <Select value={selectedTimeRange} onValueChange={setSelectedTimeRange}>
        <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select time range" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This week</SelectItem>
            <SelectItem value="month">This month</SelectItem>
        </SelectContent>
        </Select>
      </div>

      {/* Content Area */}
      {loading && cardData.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading activities...</span>
          </div>
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-center text-red-600">
            {error}
          </CardContent>
        </Card>
      ) : cardData.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No activities found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 mb-6">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Refreshing...</span>
              </div>
            </div>
          )}
          {cardData.map((data, index) => (
            <ActivityCard key={data.eventId || index} data={data} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 sm:mt-8">
          <Pagination>
            <PaginationContent className="flex flex-wrap sm:flex-nowrap justify-center gap-0 sm:gap-1">
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className={currentPage === 1 || loading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
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
                      onClick={() => setCurrentPage(item.number)}
                      isActive={currentPage === item.number}
                      className={`cursor-pointer px-2 sm:px-3 ${loading ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {item.number}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}

              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className={currentPage === totalPages || loading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};

export default ActivityFeedCards;
