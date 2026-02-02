import { ReactNode, useState } from "react";
import { Card, CardContent } from "../ui/card";
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  ArrowDown,
  ArrowRightLeft,
  ArrowLeftRight,
  Download,
  Landmark,
  Gift,
  UserPlus,
  Send,
  LucideIcon
} from "lucide-react";
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
  image?: string; // Image URL for asset addresses
  imageFallback?: string; // Fallback text (e.g., symbol) when no image
}

export type ActivityTypeIcon = "transfer" | "deposit" | "cdp-mint" | "swap" | "rewards" | "referral";

export interface ActivityCardData {
  title: string;
  fields: ActivityField[];
  timestamp: string;
  eventId?: string; // For React key
  activityTypeIcon?: ActivityTypeIcon; // Icon type for the activity
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
 * Get activity type icon component
 */
const getActivityTypeIcon = (type?: ActivityTypeIcon): { icon: LucideIcon; color: string } => {
  switch (type) {
    case "transfer":
      return { icon: Send, color: "bg-blue-500" };
    case "deposit":
      return { icon: Download, color: "bg-green-500" };
    case "cdp-mint":
      return { icon: Landmark, color: "bg-purple-500" };
    case "swap":
      return { icon: ArrowLeftRight, color: "bg-orange-500" };
    case "rewards":
      return { icon: Gift, color: "bg-yellow-500" };
    case "referral":
      return { icon: UserPlus, color: "bg-pink-500" };
    default:
      return { icon: ArrowRightLeft, color: "bg-gray-500" };
  }
};

/**
 * Asset image display component with fallback
 */
const AssetImageDisplay = ({ 
  image, 
  fallback, 
  isUserAddress,
  showTooltip = false
}: { 
  image: string; 
  fallback: string; 
  isUserAddress?: boolean;
  showTooltip?: boolean;
}) => {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
        style={{ backgroundColor: "red" }}
      >
        {fallback.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={image}
      alt={fallback}
      className={`w-6 h-6 rounded-full object-cover border ${
        showTooltip ? "cursor-help" : ""
      } ${isUserAddress ? "ring-2 ring-primary" : ""}`}
      onError={() => setError(true)}
    />
  );
};

/**
 * Reusable Activity Card component
 * Renders a standardized card based on ActivityCardData
 */
export const ActivityCard = ({ data }: { data: ActivityCardData }) => {
  const activityIcon = getActivityTypeIcon(data.activityTypeIcon);
  const IconComponent = activityIcon.icon;

  // Render a single field value
  const renderFieldValue = (field: ActivityField): ReactNode => {
    const tooltipValue = field.tooltip || (field.type === "address" ? field.value : undefined);
    
    if (field.type === "address") {
      if (field.image) {
        // For token images, only show tooltip if there's a meaningful value (not just the address)
        // Token images should show the token name (badge) next to them
        const hasTooltip = field.tooltip && field.tooltip.trim();
        const imageEl = (
          <AssetImageDisplay
            image={field.image}
            fallback={field.imageFallback || field.value}
            isUserAddress={field.isUserAddress}
            showTooltip={!!hasTooltip}
          />
        );
        
        // Only show tooltip for token images if tooltip is explicitly provided and not empty
        if (hasTooltip) {
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {imageEl}
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono text-xs">{field.tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        }
        return imageEl;
      } else {
        const displayValue = formatAddress(field.value);
        const codeEl = (
          <code className={`text-xs bg-muted px-2 py-1 rounded ${field.isUserAddress ? "ring-2 ring-primary" : ""}`}>
            {displayValue}
          </code>
        );
        
        const addressContent = tooltipValue ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {codeEl}
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">{tooltipValue}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : codeEl;
        
        return (
          <>
            {addressContent}
            <CopyButton address={field.value} />
          </>
        );
      }
    } else if (field.type === "amount") {
      return (
        <span className="font-semibold">
          {field.value} {field.badge && field.badge}
        </span>
      );
    } else {
      // text type
      if (tooltipValue) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <code className="text-xs bg-muted px-2 py-1 rounded cursor-help">
                  {field.value}
                </code>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">{tooltipValue}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }
      return <span>{field.value}</span>;
    }
  };

  // Build description from all fields
  const descriptionParts: ReactNode[] = [];
  data.fields.forEach((field, index) => {
    if (index > 0) {
      descriptionParts.push(<span key={`sep-${index}`}> • </span>);
    }
    
    const fieldIcon = field.icon ? getIcon(field.icon) : null;
    
    descriptionParts.push(
      <span key={index} className="inline-flex items-center gap-1">
        {fieldIcon}
        <span className="text-muted-foreground">{field.label}:</span>
        {renderFieldValue(field)}
        {field.badge && (
          <Badge variant="secondary" className="text-xs">
            {field.badge}
          </Badge>
        )}
        {field.isUserAddress && (
          <Badge variant="default" className="bg-primary text-primary-foreground text-xs">
            You
          </Badge>
        )}
        {field.additionalContent}
      </span>
    );
  });

  return (
    <Card key={data.eventId} className="hover:bg-muted/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Left: Activity Icon */}
          <div className={`${activityIcon.color} w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0`}>
            <IconComponent className="h-5 w-5 text-white" />
          </div>

          {/* Middle: Title and Description */}
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm mb-1">{data.title}</h3>
            <div className="text-xs flex flex-wrap items-center gap-1">
              {descriptionParts}
            </div>
          </div>

          {/* Right: Timestamp */}
          <div className="text-right flex-shrink-0">
            <div className="text-xs text-muted-foreground">
              {formatEventDate(data.timestamp)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
