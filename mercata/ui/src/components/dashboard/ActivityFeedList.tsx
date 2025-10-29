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
  Minus,
  Download
} from "lucide-react";
import { formatUnits } from "viem";
import { activityFeedApi } from "@/lib/activityFeed";
import type { Event } from "@mercata/shared-types";
import { useUser } from "@/context/UserContext";

const ActivityFeedList = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [totalEvents, setTotalEvents] = useState(0);
  const [filters, setFilters] = useState<FilterOptions>({});
  const itemsPerPage = 10;
  const { isLoggedIn, userAddress, isAdmin } = useUser();

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
          event_name: filters.event_name ? `eq.${filters.event_name}` : undefined,
          transaction_sender: filters.transaction_sender ? `eq.${filters.transaction_sender}` : undefined
        };
        
        const response = await activityFeedApi.getEvents({
          offset: offset,
          limit: itemsPerPage,
          ...apiFilters
        });
        
        setEvents(response.events || []);
        setTotalEvents(response.total || 0);
        setTotalPages(Math.ceil((response.total || 0) / itemsPerPage));
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
  const formatAddress = useCallback((address: string | null) => {
    if (!address) return "N/A";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  const formatTimestamp = useCallback((timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  }, []);

  const getEventIcon = useCallback((eventName: string) => {
    switch (eventName.toLowerCase()) {
      case 'transfer':
        return <ArrowUpRight className="h-3 w-3 sm:h-4 sm:w-4" />;
      case 'mint':
        return <ArrowDownLeft className="h-3 w-3 sm:h-4 sm:w-4" />;
      case 'burn':
        return <Minus className="h-3 w-3 sm:h-4 sm:w-4" />;
      default:
        return <Activity className="h-3 w-3 sm:h-4 sm:w-4" />;
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

  const downloadCSV = useCallback(async () => {
    try {
      setLoading(true);
      
      // Get all events without pagination
      const apiFilters = {
        ...filters,
        contract_name: filters.contract_name ? `eq.${filters.contract_name}` : undefined,
        event_name: filters.event_name ? `eq.${filters.event_name}` : undefined,
        transaction_sender: filters.transaction_sender ? `eq.${filters.transaction_sender}` : undefined
      };
      
      const response = await activityFeedApi.getEvents({
        limit: totalEvents || 10000, // Get all events or a large number
        offset: 0,
        ...apiFilters
      });
      
      const allEvents = response.events || [];
      
      if (allEvents.length === 0) {
        alert('No data to export');
        return;
      }
      
      // Create CSV headers
      const headers = [
        'Event Name',
        'Contract Name',
        'Block Number',
        'Block Timestamp',
        'Transaction Hash',
        'Transaction Sender',
        'Contract Address',
        'Event Index'
      ];
      
      // Add dynamic attribute headers
      const attributeKeys = new Set<string>();
      allEvents.forEach(event => {
        Object.keys(event.attributes).forEach(key => attributeKeys.add(key));
      });
      
      headers.push(...Array.from(attributeKeys).sort());
      
      // Create CSV rows
      const csvRows = [
        headers.join(','), // Header row
        ...allEvents.map(event => {
          const baseData = [
            `"${event.event_name}"`,
            `"${event.contract_name}"`,
            event.block_number,
            `"${formatTimestamp(event.block_timestamp)}"`,
            `"${event.transaction_hash}"`,
            `"${event.transaction_sender}"`,
            `"${event.address}"`,
            event.event_index
          ];
          
          // Add attribute values in the same order as headers
          const attributeValues = Array.from(attributeKeys).map(key => {
            const value = event.attributes[key] || '';
            // Format values if they contain numeric data or addresses
            if (key.toLowerCase().includes('value')) {
              return `"${formatValue(value)}"`;
            }
            return `"${value}"`;
          });
          
          return [...baseData, ...attributeValues].join(',');
        })
      ];
      
      // Create and download the CSV file
      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `blockchain-events-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Error downloading CSV:', error);
      alert('Failed to download CSV. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters, totalEvents, formatTimestamp, formatValue]);

  // Memoized computed values to prevent unnecessary recalculations
  const paginationInfo = useMemo(() => {
    const startItem = events.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const endItem = Math.min(currentPage * itemsPerPage, totalEvents);
    return { startItem, endItem };
  }, [events.length, currentPage, itemsPerPage, totalEvents]);

  const paginationItems = useMemo(() => {
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
  }, [currentPage, totalPages]);

  // Memoized event card renderer to prevent unnecessary re-renders
  const renderEventCard = useCallback((event: Event) => (
    <Card key={`${event.transaction_hash}-${event.id}`} className="mb-3 sm:mb-4 hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={`p-1.5 sm:p-2 rounded-full ${getEventColor(event.event_name)}`}>
              {getEventIcon(event?.event_name ? event?.event_name : 'N/A')}
            </div>
            <div>
              <CardTitle className="text-base sm:text-lg font-semibold">{event?.event_name ? event?.event_name : 'N/A'}</CardTitle>
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs sm:text-sm text-gray-600">
                <Building2 className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>{event?.contract_name ? event?.contract_name : 'N/A'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:block sm:text-right">
            <Badge variant="outline" className="text-xs inline-flex">
              Block #{event?.block_number ? event?.block_number : 'N/A'}
            </Badge>
            <div className="text-xs text-gray-500 sm:mt-1">
              {formatTimestamp(event?.block_timestamp ? event?.block_timestamp : 'N/A')}
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="px-3 sm:px-6 pt-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <Hash className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500" />
              <span className="font-medium">Transaction:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded cursor-help">
                      {event?.transaction_hash ? formatAddress(event?.transaction_hash) : 'N/A'}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{event?.transaction_hash ? event?.transaction_hash : 'N/A'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <User className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500" />
              <span className="font-medium">Sender:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded cursor-help">
                      {event?.transaction_sender ? formatAddress(event?.transaction_sender) : 'N/A'}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{event?.transaction_sender ? event?.transaction_sender : 'N/A'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="font-medium">Contract:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="text-xs bg-gray-100 px-2 py-1 rounded cursor-help">
                      {event?.address ? formatAddress(event?.address) : 'N/A'}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono text-xs">{event?.address ? event?.address : 'N/A'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="text-xs sm:text-sm font-medium text-gray-700">Event Attributes:</div>
            <div className="space-y-1">
              {Object.entries(event?.attributes).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs sm:text-sm">
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
                                  {value ? formatAddress(value) : 'N/A'}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-mono text-xs">{value ? value : 'N/A'}</p>
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
        userAddress={userAddress}
      />
      
      {error && (
        <Card className="mb-6">
          <CardContent className="p-6 text-center">
            <div className="text-red-600 mb-2">Error loading events</div>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </CardContent>
        </Card>
      )}
      
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs sm:text-sm text-gray-600">
            Showing {paginationInfo.startItem}-{paginationInfo.endItem} of {totalEvents} events
            {loading && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-xs">Updating...</span>
              </span>
            )}
          </div>
          {isAdmin && (
            <Button 
              onClick={downloadCSV}
              disabled={loading || events.length === 0}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          )}
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
            <div key={`${event.transaction_hash}-${event.id}`}>
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
        <div className="mt-6 sm:mt-8 pb-12 sm:pb-0">
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
                      <span className="px-3 py-2 text-sm text-gray-500">...</span>
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

export default ActivityFeedList; 