import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ActivityFeedFilters, { FilterOptions } from "./ActivityFeedFilters";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { 
  Activity, 
  Hash, 
  User, 
  Building2, 
  FileText,
  ArrowUpRight,
  ArrowDownLeft,
  Minus
} from "lucide-react";
import { formatUnits } from "viem";
import { activityFeedApi, BlockchainEvent } from "@/lib/activityFeed";
import { useUser } from "@/context/UserContext";

const ActivityFeedList = () => {
  const [events, setEvents] = useState<BlockchainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [totalEvents, setTotalEvents] = useState(0);
  const [filters, setFilters] = useState<FilterOptions>({});
  const itemsPerPage = 10;
  const { isLoggedIn } = useUser();

  const [filterOptions, setFilterOptions] = useState<{ 
    contractNames: string[]; 
    eventNames: Array<{ name: string; contract: string }>;
  }>({ contractNames: [], eventNames: [] });
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);

  // Simple cache outside component to persist across re-renders
  const filterCache = useMemo(() => {
    let cache: { 
      contractNames: string[]; 
      eventNames: Array<{ name: string; contract: string }>;
    } | null = null;
    let promise: Promise<{ 
      contractNames: string[]; 
      eventNames: Array<{ name: string; contract: string }>;
    }> | null = null;

    return {
      async get() {
        if (cache) return cache;
        if (promise) return promise;
        
        promise = activityFeedApi.getFilterOptions().then((options) => {
          cache = options;
          return cache;
        });
        
        return promise;
      }
    };
  }, []);

  // Load filter options once
  useEffect(() => {
    if (!isLoggedIn || filterOptionsLoaded) return;
    
    const loadOptions = async () => {
      try {
        const options = await filterCache.get();
        setFilterOptions(options);
        setFilterOptionsLoaded(true);
      } catch (error) {
        // Silently handle filter loading errors
      }
    };
    
    loadOptions();
  }, [isLoggedIn, filterCache, filterOptionsLoaded]);

  useEffect(() => {
    const fetchEvents = async () => {
      if (!isLoggedIn) {
        return;
      }
      
      setLoading(true);
      try {
        const offset = (currentPage - 1) * itemsPerPage;
        // Add eq. prefix to filter values for backend
        const apiFilters = {
          ...filters,
          contract_name: filters.contract_name ? `eq.${filters.contract_name}` : undefined,
          event_name: filters.event_name ? `eq.${filters.event_name}` : undefined
        };
        
        const response = await activityFeedApi.getEvents({
          offset: offset,
          limit: itemsPerPage,
          ...apiFilters
        });
        
        setEvents(response.events || []);
        setTotalPages(response.totalPages || 1);
        setTotalEvents(response.total || 0);
        setError(null);
      } catch (err) {
        setError(`Failed to fetch events: ${err.response?.data?.message || err.message}`);
      } finally {
        setLoading(false);
      }
    };

    // Debounce filter changes to prevent rapid API calls
    const timeoutId = setTimeout(() => {
      fetchEvents();
    }, 300); // 300ms delay

    return () => clearTimeout(timeoutId);
  }, [currentPage, isLoggedIn, filters]);

  // Memoized utility functions to prevent unnecessary re-renders
  const formatAddress = useCallback((address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  const formatTimestamp = useCallback((timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  }, []);

  const getEventIcon = useCallback((eventName: string) => {
    switch (eventName.toLowerCase()) {
      case 'transfer':
        return <ArrowUpRight className="h-4 w-4" />;
      case 'mint':
        return <ArrowDownLeft className="h-4 w-4" />;
      case 'burn':
        return <Minus className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  }, []);

  const getEventColor = useCallback((eventName: string) => {
    switch (eventName.toLowerCase()) {
      case 'transfer':
        return 'bg-blue-100 text-blue-800';
      case 'mint':
        return 'bg-green-100 text-green-800';
      case 'burn':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }, []);

  const formatValue = useCallback((value: string, decimals: number = 18) => {
    try {
      const formatted = formatUnits(BigInt(value), decimals);
      return parseFloat(formatted).toLocaleString(undefined, {
        maximumFractionDigits: 6,
        minimumFractionDigits: 0
      });
    } catch {
      return value;
    }
  }, []);

  const handleFiltersChange = useCallback((newFilters: FilterOptions) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  }, []);

  // Memoized computed values to prevent unnecessary recalculations
  const paginationInfo = useMemo(() => {
    const startItem = events.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endItem = Math.min(currentPage * itemsPerPage, totalEvents);
    return { startItem, endItem };
  }, [events.length, currentPage, itemsPerPage, totalEvents]);

  const paginationItems = useMemo(() => {
    if (totalPages <= 1) return [];
    
    const pages = [];
    const maxVisiblePages = 7;
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
  }, [currentPage, totalPages]);

  // Memoized event card renderer to prevent unnecessary re-renders
  const renderEventCard = useCallback((event: BlockchainEvent) => (
    <Card key={`${event.transaction_hash}-${event.event_index}`} className="mb-4 hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${getEventColor(event.event_name)}`}>
              {getEventIcon(event.event_name)}
            </div>
            <div>
              <CardTitle className="text-lg font-semibold">{event.event_name}</CardTitle>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Building2 className="h-4 w-4" />
                <span>{event.contract_name}</span>
                <span>•</span>
                <span>{event.application}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <Badge variant="outline" className="text-xs">
              Block #{event.block_number}
            </Badge>
            <div className="text-xs text-gray-500 mt-1">
              {formatTimestamp(event.block_timestamp)}
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Hash className="h-4 w-4 text-gray-500" />
              <span className="font-medium">Transaction:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded cursor-help">
                      {formatAddress(event.transaction_hash)}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{event.transaction_hash}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-gray-500" />
              <span className="font-medium">Sender:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded cursor-help">
                      {formatAddress(event.transaction_sender)}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{event.transaction_sender}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" />
              <span className="font-medium">Contract:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded cursor-help">
                      {formatAddress(event.address)}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{event.address}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">Event Attributes:</div>
            <div className="space-y-1">
              {Object.entries(event.attributes).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-gray-600 capitalize">{key}:</span>
                  <span className="font-mono text-xs">
                    {key.toLowerCase().includes('value') 
                      ? formatValue(value)
                      : key.toLowerCase().includes('address') || key.toLowerCase().includes('from') || key.toLowerCase().includes('to')
                      ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">
                                  {formatAddress(value)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-mono text-xs">{value}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )
                      : value
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  ), [formatAddress, formatTimestamp, getEventIcon, getEventColor, formatValue]);

  return (
    <div>
      <ActivityFeedFilters 
        filters={filters}
        onFiltersChange={handleFiltersChange}
        contractNames={filterOptions.contractNames}
        eventNames={filterOptions.eventNames}
      />
      
      {error && (
        <Card className="mb-6">
          <CardContent className="p-6 text-center">
            <div className="text-red-600 mb-2">Error loading events</div>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </CardContent>
        </Card>
      )}
      
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {paginationInfo.startItem}-{paginationInfo.endItem} of {totalEvents} events
            {loading && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-xs">Updating...</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {events.length === 0 && !loading ? (
          <Card>
            <CardContent className="p-6 text-center text-gray-500">
              No events found
            </CardContent>
          </Card>
        ) : (
          events.map((event) => (
            <div key={`${event.transaction_hash}-${event.event_index}`}>
              {renderEventCard(event)}
            </div>
          ))
        )}
        
        {loading && events.length > 0 && (
          <div className="flex items-center justify-center py-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading new events...</span>
            </div>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-8">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className={currentPage === 1 || loading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              
              {paginationItems.map((item, index) => {
                if (item.type === 'ellipsis') {
                  return (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <span className="px-3 py-2 text-sm text-gray-500">...</span>
                    </PaginationItem>
                  );
                }
                
                return (
                  <PaginationItem key={item.number}>
                    <PaginationLink
                      onClick={() => setCurrentPage(item.number)}
                      isActive={currentPage === item.number}
                      className={`cursor-pointer ${loading ? 'opacity-50 pointer-events-none' : ''}`}
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

export default ActivityFeedList; 