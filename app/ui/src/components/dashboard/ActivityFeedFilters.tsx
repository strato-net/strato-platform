import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter, User } from "lucide-react";
import { memo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface FilterOptions {
  contract_name?: string;
  event_name?: string;
  transaction_sender?: string;
}

interface ActivityFeedFiltersProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  contractNames: string[];
  eventNames: Array<{ name: string; contract: string }>;
  userAddress?: string | null;
}

const ActivityFeedFilters = memo(({ 
  filters, 
  onFiltersChange, 
  contractNames, 
  eventNames,
  userAddress
}: ActivityFeedFiltersProps) => {

  const handleContractChange = (value: string) => {
    const newFilters = {
      ...filters,
      contract_name: value === "all" ? undefined : value,
      event_name: undefined // Reset event filter when contract changes
    };
    onFiltersChange(newFilters);
  };

  const handleEventChange = (value: string) => {
    const newFilters = {
      ...filters,
      event_name: value === "all" ? undefined : value
    };
    onFiltersChange(newFilters);
  };

  const handleMyTransactionsToggle = () => {
    const newFilters = {
      ...filters,
      transaction_sender: filters.transaction_sender ? undefined : userAddress || undefined
    };
    onFiltersChange(newFilters);
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const hasActiveFilters = filters.contract_name || filters.event_name || filters.transaction_sender;

  // Filter events based on selected contract
  const availableEvents = filters.contract_name 
    ? eventNames.filter(event => event.contract === filters.contract_name)
    : eventNames;

  // Deduplicate event names to prevent "DepositedDeposited" when "All Contracts" is selected
  // Sort event names alphabetically
  const uniqueEventNames = Array.from(
    new Map(availableEvents.map(event => [event.name, event])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mb-4 sm:mb-6 p-3 sm:p-4 border rounded-lg bg-muted/50 border-border">
      <div className="flex items-center gap-2 mb-2 sm:mb-3">
        <Filter className="h-3 w-3 sm:h-4 sm:w-4" />
        <span className="text-sm sm:text-base font-medium">Filters</span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-6 px-2 text-xs"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 w-full sm:w-auto">
          <label className="text-xs sm:text-sm font-medium text-foreground sm:min-w-fit">Contract:</label>
          <Select
            value={filters.contract_name || "all"}
            onValueChange={handleContractChange}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select contract" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contracts</SelectItem>
              {contractNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 w-full sm:w-auto">
          <label className="text-xs sm:text-sm font-medium text-foreground sm:min-w-fit">Event:</label>
          <Select
            value={filters.event_name || "all"}
            onValueChange={handleEventChange}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              {uniqueEventNames.map((event) => (
                <SelectItem key={`${event.contract}-${event.name}`} value={event.name}>
                  {event.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {userAddress && (
          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-2">
            <div className="hidden sm:block w-px h-6 bg-border mx-2"></div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={filters.transaction_sender ? "default" : "outline"}
                    size="sm"
                    onClick={handleMyTransactionsToggle}
                    className={`h-9 transition-all duration-200 relative ${
                      filters.transaction_sender 
                        ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md scale-105" 
                        : "hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 hover:scale-105"
                    }`}
                  >
                    {filters.transaction_sender && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                    )}
                    My Transactions
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Filter to show only transactions where you are the sender</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>

      {hasActiveFilters && (
        <div className="mt-2 sm:mt-3 flex flex-wrap gap-1 sm:gap-2">
          {filters.contract_name && (
            <Badge variant="secondary" className="text-xs">
              Contract: {filters.contract_name}
            </Badge>
          )}
          {filters.event_name && (
            <Badge variant="secondary" className="text-xs">
              Event: {filters.event_name}
            </Badge>
          )}
          {filters.transaction_sender && (
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">
              My Transactions
            </Badge>
          )}
        </div>
      )}
    </div>
  );
});

export default ActivityFeedFilters; 