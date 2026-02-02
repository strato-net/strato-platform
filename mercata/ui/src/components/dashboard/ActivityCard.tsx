import { ReactNode } from "react";
import { Card, CardTitle, CardHeader, CardContent } from "../ui/card";
import { ArrowUpRight, ArrowDownLeft, ArrowDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import CopyButton from "@/components/ui/copy";
import { Badge } from "@/components/ui/badge";

export type FieldIcon = "arrow-up-right" | "arrow-down-left" | "arrow-down" | null;

export interface ActivityField {
  label: string;
  value: string;
  type?: "address" | "text" | "amount";
  icon?: FieldIcon;
  badge?: string; // For token symbols, chain names, etc.
  tooltip?: string; // Full value for tooltip (usually full address)
  isUserAddress?: boolean;
  additionalContent?: ReactNode; // For things like "+X more" tooltip
  size?: "sm" | "xs"; // Text size - defaults to "sm"
}

export interface ActivityCardData {
  title: string;
  fields: ActivityField[];
  timestamp: string;
  eventId?: string; // For React key
}

/**
 * Format address for display (truncated)
 */
const formatAddress = (addr: string): string => {
  if (!addr) return "N/A";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

/**
 * Format block timestamp to readable date string in local time
 */
const formatEventDate = (timestamp: string | undefined): string => {
  if (!timestamp || timestamp === 'N/A') return 'N/A';
  try {
    const normalizedTimestamp = timestamp.replace(' UTC', 'Z').replace(' ', 'T');
    const date = new Date(normalizedTimestamp);
    
    if (isNaN(date.getTime())) return 'N/A';
    
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return 'N/A';
  }
};

/**
 * Get icon component from icon name
 */
const getIcon = (icon: FieldIcon) => {
  switch (icon) {
    case "arrow-up-right":
      return <ArrowUpRight className="h-4 w-4 text-muted-foreground" />;
    case "arrow-down-left":
      return <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />;
    case "arrow-down":
      return <ArrowDown className="h-4 w-4 text-muted-foreground" />;
    default:
      return null;
  }
};

/**
 * Reusable Activity Card component
 * Renders a standardized card based on ActivityCardData
 */
export const ActivityCard = ({ data }: { data: ActivityCardData }) => {
  const renderField = (field: ActivityField, index: number) => {
    const icon = field.icon ? getIcon(field.icon) : null;
    const displayValue = field.type === "address" ? formatAddress(field.value) : field.value;
    const tooltipValue = field.tooltip || (field.type === "address" ? field.value : undefined);
    const textSize = field.size === "xs" ? "text-xs" : "text-sm";

    return (
      <div key={index} className={`flex items-center gap-2 ${textSize}`}>
        {icon}
        <span className="text-muted-foreground">{field.label}:</span>
        <div className="flex items-center gap-1">
          {field.type === "address" ? (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code
                      className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${
                        field.isUserAddress ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      {displayValue}
                    </code>
                  </TooltipTrigger>
                  {tooltipValue && (
                    <TooltipContent>
                      <p className="font-mono text-xs">{tooltipValue}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
              <CopyButton address={field.value} />
              {field.isUserAddress && (
                <Badge variant="default" className="ml-1 bg-primary text-primary-foreground text-xs">
                  You
                </Badge>
              )}
            </>
          ) : (
            <>
              {tooltipValue ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code className="text-xs bg-muted px-2 py-1 rounded cursor-help">
                        {displayValue}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-mono text-xs">{tooltipValue}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <span className={field.type === "amount" ? "font-semibold" : ""}>{displayValue}</span>
              )}
            </>
          )}
          {field.badge && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {field.badge}
            </Badge>
          )}
          {field.additionalContent}
        </div>
      </div>
    );
  };

  return (
    <Card key={data.eventId}>
      <CardHeader>
        <CardTitle>{data.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.fields.map((field, index) => renderField(field, index))}
        <div className="text-xs text-muted-foreground pt-2 border-t">
          {formatEventDate(data.timestamp)}
        </div>
      </CardContent>
    </Card>
  );
};
