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

interface ActivityFeedCardsProps {
  isMyActivity: boolean;
}

const ActivityFeedCards = ({ isMyActivity }: ActivityFeedCardsProps) => {
  const { userAddress } = useUser();
  const [cards, setCards] = useState<React.ReactNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedActivityType, setSelectedActivityType] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const itemsPerPage = 10;

  const fetchAllActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      
      // Build activity type pairs - filter by selected type if not "all"
      let activityTypePairs = Object.values(activityTypes).map((config) => ({
        contract_name: config.contract_name,
        event_name: config.event_name,
      }));
      
      // Filter by selected activity type if not "all"
      if (selectedActivityType !== "all") {
        const selectedConfig = activityTypes[selectedActivityType];
        if (selectedConfig) {
          activityTypePairs = [{
            contract_name: selectedConfig.contract_name,
            event_name: selectedConfig.event_name,
          }];
        }
      }
      
      // Use the backend endpoint that handles exact pair matching
      const response = await activityFeedApi.getActivities(activityTypePairs, {
        limit: itemsPerPage,
        offset: offset,
        myActivity: isMyActivity,
      });

        // Collect token addresses using getTokenAddress from activity type configs
        const allTokenAddresses = [...new Set(
          response.events
            .map(event => {
              // Find matching activity type
              const matchingType = Object.entries(activityTypes).find(
                ([_, config]) =>
                  config.contract_name === event.contract_name &&
                  config.event_name === event.event_name
              );
              
              // Extract token address using the config's getTokenAddress function
              if (matchingType && matchingType[1].getTokenAddress) {
                return matchingType[1].getTokenAddress(event);
              }
              return undefined;
            })
            .filter((addr): addr is string => !!addr)
        )];
        const tokenSymbolMap = new Map<string, string>();
        
        if (allTokenAddresses.length > 0) {
          try {
            // Fetch token symbols in batch
            const tokenPromises = allTokenAddresses.map(async (address) => {
              try {
                const res = await api.get(`/tokens/${address}`);
                const token = Array.isArray(res.data) ? res.data[0] : res.data;
                return { address, symbol: token?._symbol || token?.token?._symbol || "" };
              } catch {
                return { address, symbol: "" };
              }
            });
            const tokenResults = await Promise.all(tokenPromises);
            tokenResults.forEach(({ address, symbol }) => {
              if (symbol) {
                tokenSymbolMap.set(address, symbol);
              }
            });
          } catch (err) {
            // If fetching symbols fails, continue without them
            console.warn("Failed to fetch token symbols:", err);
          }
        }

        // Route each event to the appropriate handler
        const allCards: React.ReactNode[] = [];
        for (const event of response.events) {
          // Find matching activity type by contract_name and event_name
          const matchingType = Object.entries(activityTypes).find(
            ([_, config]) =>
              config.contract_name === event.contract_name &&
              config.event_name === event.event_name
          );

          if (matchingType) {
            const [, config] = matchingType;
            // Get token symbol using the config's getTokenAddress function
            let tokenSymbol: string | undefined;
            if (config.getTokenAddress) {
              const tokenAddress = config.getTokenAddress(event);
              tokenSymbol = tokenAddress ? tokenSymbolMap.get(tokenAddress) : undefined;
            }
            const card = config.handler(event, tokenSymbol, userAddress);
            allCards.push(card);
          }
        }

      setCards(allCards);
      setTotalPages(Math.ceil((response.total || 0) / itemsPerPage));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch activities");
    } finally {
      setLoading(false);
    }
  }, [userAddress, isMyActivity, currentPage, selectedActivityType]);

  useEffect(() => {
    fetchAllActivities();
  }, [fetchAllActivities, refreshKey]);

  // Reset to page 1 when activity type changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedActivityType]);

  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
    setCurrentPage(1); // Reset to first page on refresh
  }, []);

  // Get activity type display names from config
  const activityTypeOptions = [
    { value: "all", label: "All types" },
    ...Object.entries(activityTypes).map(([key, config]) => ({
      value: key,
      label: config.displayName || key,
    })),
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
      <div className="flex items-center justify-between gap-4 mb-4">
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
        
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Content Area */}
      {loading && cards.length === 0 ? (
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
      ) : cards.length === 0 ? (
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
          {cards}
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
