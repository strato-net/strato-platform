import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter } from "lucide-react";
import { memo } from "react";

export interface FilterOptions {
  contract_name?: string;
  event_name?: string;
}

interface ActivityFeedFiltersProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  contractNames: string[];
  eventNames: Array<{ name: string; contract: string }>;
}

const ActivityFeedFilters = memo(({ 
  filters, 
  onFiltersChange, 
  contractNames, 
  eventNames
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

  const clearFilters = () => {
    onFiltersChange({});
  };

  const hasActiveFilters = filters.contract_name || filters.event_name;

  // Filter events based on selected contract
  const availableEvents = filters.contract_name 
    ? eventNames.filter(event => event.contract === filters.contract_name)
    : eventNames;

  return (
    <div className="mb-6 p-4 border rounded-lg bg-gray-50">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="h-4 w-4" />
        <span className="font-medium">Filters</span>
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

      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Contract:</label>
          <Select
            value={filters.contract_name || "all"}
            onValueChange={handleContractChange}
          >
            <SelectTrigger className="w-48">
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

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Event:</label>
          <Select
            value={filters.event_name || "all"}
            onValueChange={handleEventChange}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select event" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              {availableEvents.map((event) => (
                <SelectItem key={`${event.contract}-${event.name}`} value={event.name}>
                  {event.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
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
        </div>
      )}
    </div>
  );
});

export default ActivityFeedFilters; 