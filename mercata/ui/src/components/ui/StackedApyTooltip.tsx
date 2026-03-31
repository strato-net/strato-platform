import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StackedApyBreakdown } from "@/lib/stackedApy";

type StackedApyTooltipProps = {
  breakdown?: StackedApyBreakdown | null;
  valueText: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  fallbackText?: string;
};

const hasBreakdown = (breakdown?: StackedApyBreakdown | null) =>
  !!breakdown && (breakdown.native > 0 || breakdown.base > 0 || breakdown.reward > 0);

export default function StackedApyTooltip({
  breakdown,
  valueText,
  className = "",
  side = "top",
  fallbackText,
}: StackedApyTooltipProps) {
  if (!hasBreakdown(breakdown)) {
    return <span className={className}>{fallbackText || valueText}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`${className} cursor-help`}>{valueText}</span>
        </TooltipTrigger>
        <TooltipContent side={side} className="text-xs">
          <div className="flex flex-col gap-1">
            {breakdown.native > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Native APY:</span>
                <span className="font-medium">{breakdown.native.toFixed(2)}%</span>
              </div>
            )}
            {breakdown.base > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Base APY:</span>
                <span className="font-medium">{breakdown.base.toFixed(2)}%</span>
              </div>
            )}
            {breakdown.reward > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Reward APY:</span>
                <span className="font-medium">{breakdown.reward.toFixed(2)}%</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
