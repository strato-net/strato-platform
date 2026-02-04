import { ReactNode, useState } from "react";
import { Card, CardContent } from "../ui/card";
import {
  ArrowRightLeft,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import CopyButton from "@/components/ui/copy";
import ExplorerButton from "@/components/ui/explorer";
import { Badge } from "@/components/ui/badge";
import { ActivityIconConfig } from "./activityTypes";

export type FieldIcon = "arrow-up-right" | "arrow-down-left" | "arrow-down" | null;

export interface ActivityField {
  label: string;
  value: string;
  type?: "address" | "text" | "amount";
  icon?: FieldIcon;
  badge?: string; // For token symbols, chain names, etc.
  tooltip?: string; // Full value for tooltip (usually full address or full amount)
  isUserAddress?: boolean;
  additionalContent?: ReactNode; // For things like "+X more" tooltip
  size?: "sm" | "xs"; // Text size - defaults to "sm"
  image?: string; // Image URL for asset addresses
  imageFallback?: string; // Fallback text (e.g., symbol) when no image
  rawAmount?: string; // Raw amount value for tooltip (for amount fields)
  explorerUrl?: string; // Explorer URL for transaction hashes
}


/**
 * Layout configuration for activity cards
 */
export type LayoutConfig = {
  type: "two-line";
  line1: {
    fieldLabels: string[]; // Which field labels go on line 1
    renderer?: "amount-with-token" | "amounts-with-arrow" | "amounts-with-and"; // Special renderer for line 1
  };
  line2: {
    fieldLabels: string[]; // Which field labels go on line 2
    renderer?: "addresses-with-arrow" | "addresses-with-bullet" | "addresses-with-arrow-and-text"; // Special renderer for line 2
  };
};

export interface ActivityCardData {
  title: string;
  fields: ActivityField[];
  timestamp: string;
  eventId?: string; // For React key
  iconConfig?: ActivityIconConfig; // Icon configuration for the activity
  layout: LayoutConfig; // Layout configuration for rendering
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
  // Use provided iconConfig or fallback to default
  const activityIcon = data.iconConfig || { icon: ArrowRightLeft, color: "bg-gray-500" };
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
      const amountContent = (
        <span className="font-semibold inline-flex items-center gap-1">
          {field.value}
          {field.badge && <span>{field.badge}</span>}
          {field.image && (
            <AssetImageDisplay
              image={field.image}
              fallback={field.imageFallback || field.badge || ""}
              isUserAddress={false}
              showTooltip={false}
            />
          )}
        </span>
      );

      // Show tooltip with full amount if rawAmount is provided
      const tooltipText = field.tooltip || (field.rawAmount ? `${field.rawAmount} ${field.badge || ""}`.trim() : undefined);

      if (tooltipText && tooltipText.trim()) {
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">{amountContent}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">{tooltipText}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }

      return amountContent;
    } else {
      // text type
      const textContent = tooltipValue ? (
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
      ) : (
        <span>{field.value}</span>
      );

      return (
        <>
          {textContent}
          {field.explorerUrl && <ExplorerButton url={field.explorerUrl} />}
        </>
      );
    }
  };

  // Helper to find a field by label
  const findFieldByLabel = (label: string): ActivityField | undefined => {
    return data.fields.find(f => f.label === label);
  };

  // Helper to render an amount field with token image
  const renderAmountWithToken = (field: ActivityField): ReactNode => {
    const amountContent = (
      <span className="font-semibold inline-flex items-center gap-1">
        {field.value}
        {field.badge && <span>{field.badge}</span>}
      </span>
    );

    return (
      <div className="inline-flex items-center gap-2">
        {field.image && (
          <AssetImageDisplay
            image={field.image}
            fallback={field.imageFallback || field.badge || ""}
            isUserAddress={false}
            showTooltip={false}
          />
        )}
        {field.rawAmount ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">{amountContent}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">{field.rawAmount} {field.badge || ""}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          amountContent
        )}
      </div>
    );
  };

  // Helper to render an address field
  const renderAddressField = (field: ActivityField, showLabel: boolean = true): ReactNode => {
    const addressValue = formatAddress(field.value);
    const addressTooltip = field.tooltip || field.value;

    return (
      <div className="inline-flex items-center gap-1">
        {showLabel && <span className="text-muted-foreground">{field.label}:</span>}
        {field.image ? (
          <>
            <AssetImageDisplay
              image={field.image}
              fallback={field.imageFallback || field.badge || field.value}
              isUserAddress={field.isUserAddress}
              showTooltip={!!(field.tooltip && field.tooltip.trim())}
            />
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
          </>
        ) : (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <code className={`text-xs bg-muted px-2 py-1 rounded cursor-help ${field.isUserAddress ? "ring-2 ring-primary" : ""}`}>
                    {addressValue}
                  </code>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono text-xs">{addressTooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <CopyButton address={field.value} />
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
          </>
        )}
      </div>
    );
  };

  // Build description based on layout config
  let descriptionParts: ReactNode[];
  const layout = data.layout;
    // Render line 1
    const line1Fields = layout.line1.fieldLabels
      .map(label => findFieldByLabel(label))
      .filter((f): f is ActivityField => f !== undefined);

    let line1: ReactNode;
    if (layout.line1.renderer === "amount-with-token" && line1Fields.length > 0) {
      line1 = renderAmountWithToken(line1Fields[0]);
    } else if (layout.line1.renderer === "amounts-with-arrow" && line1Fields.length === 2) {
      // Special renderer for Amount In --> Amount Out pattern
      const [amountInField, amountOutField] = line1Fields;
      line1 = (
        <div className="inline-flex items-center gap-2">
          {renderAmountWithToken(amountInField)}
          <span className="text-muted-foreground">→</span>
          {renderAmountWithToken(amountOutField)}
        </div>
      );
    } else if (layout.line1.renderer === "amounts-with-and" && line1Fields.length === 2) {
      // Special renderer for Token A and Token B pattern (e.g., Add Liquidity)
      const [tokenAField, tokenBField] = line1Fields;
      line1 = (
        <div className="inline-flex items-center gap-2">
          {renderAmountWithToken(tokenAField)}
          <span className="text-muted-foreground">and</span>
          {renderAmountWithToken(tokenBField)}
        </div>
      );
    } else {
      // Default: render fields normally
      line1 = (
        <div className="inline-flex items-center gap-2 flex-wrap">
          {line1Fields.map((field, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              {idx > 0 && <span className="text-muted-foreground">•</span>}
              <span className="text-muted-foreground">{field.label}:</span>
              {renderFieldValue(field)}
              {field.badge && (
                <Badge variant="secondary" className="text-xs">
                  {field.badge}
                </Badge>
              )}
            </span>
          ))}
        </div>
      );
    }

    // Render line 2
    const line2Fields = layout.line2.fieldLabels
      .map(label => findFieldByLabel(label))
      .filter((f): f is ActivityField => f !== undefined);

    let line2: ReactNode;
    if (layout.line2.renderer === "addresses-with-arrow" && line2Fields.length === 2) {
      // Special renderer for From --> To pattern
      const [fromField, toField] = line2Fields;
      line2 = (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {renderAddressField(fromField, true)}
          <span className="text-muted-foreground">→</span>
          {renderAddressField(toField, true)}
        </div>
      );
    } else if (layout.line2.renderer === "addresses-with-arrow-and-text" && line2Fields.length >= 2) {
      // Special renderer for From --> To --> additional text fields
      const [fromField, toField, ...textFields] = line2Fields;
      line2 = (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {renderAddressField(fromField, true)}
          <span className="text-muted-foreground">→</span>
          {renderAddressField(toField, true)}
          {textFields.length > 0 && <span className="text-muted-foreground">•</span>}
          {textFields.map((field, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              {idx > 0 && <span className="text-muted-foreground">•</span>}
              <span className="text-muted-foreground">{field.label}:</span>
              {renderFieldValue(field)}
            </span>
          ))}
        </div>
      );
    } else if (layout.line2.renderer === "addresses-with-bullet") {
      // Special renderer for multiple addresses with bullet separator
      line2 = (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {line2Fields.map((field, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              {idx > 0 && <span className="text-muted-foreground">•</span>}
              {renderAddressField(field, true)}
            </span>
          ))}
        </div>
      );
    } else {
      // Default: render fields normally
      line2 = (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {line2Fields.map((field, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              {idx > 0 && <span className="text-muted-foreground">•</span>}
              <span className="text-muted-foreground">{field.label}:</span>
              {renderFieldValue(field)}
              {field.badge && (
                <Badge variant="secondary" className="text-xs">
                  {field.badge}
                </Badge>
              )}
            </span>
          ))}
        </div>
      );
    }

    descriptionParts = [
      <div key="line1">{line1}</div>,
      <div key="line2">{line2}</div>
    ];

  return (
    <Card key={data.eventId} className="hover:bg-muted/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Left: Activity Icon */}
            <div className={`${activityIcon.color} w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0`}>
              <IconComponent className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
            </div>

            {/* Mobile title next to icon */}
            <h3 className="font-medium text-sm sm:text-base sm:hidden">{data.title}</h3>
          </div>

          {/* Middle: Title (desktop) and Description */}
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm sm:text-base mb-1 hidden sm:block">{data.title}</h3>
            <div className="text-xs sm:text-sm space-y-1">
              {descriptionParts}
            </div>
          </div>

          {/* Right: Timestamp */}
          <div className="text-left sm:text-right flex-shrink-0">
            <div className="text-xs text-muted-foreground sm:whitespace-nowrap">
              {formatEventDate(data.timestamp)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
