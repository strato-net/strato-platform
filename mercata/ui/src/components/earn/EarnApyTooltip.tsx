import { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";
import { EarnApyInfo } from "@/utils/earnUtils";

interface EarnApyTooltipProps {
  info?: EarnApyInfo | null;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export default function EarnApyTooltip({
  info,
  children,
  side = "top",
  align = "center",
}: EarnApyTooltipProps) {
  const { isMobile } = useMobileTooltip("earn-apy-tooltip-container");

  if (!info || info.breakdown.length === 0) {
    return <>{children}</>;
  }

  const breakdownContent = (
    <div className="flex flex-col gap-1">
      {info.breakdown.map((item) => (
        <div key={item.label} className="flex justify-between gap-4">
          <span className="text-foreground">{item.label}:</span>
          <span className="font-medium">{item.apy}%</span>
        </div>
      ))}
      {info.breakdown.length > 1 && (
        <div className="flex justify-between gap-4 border-t border-border/50 pt-1">
          <span className="text-foreground">Total:</span>
          <span className="font-medium">{info.total.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );

  return (
    <span className="earn-apy-tooltip-container inline-flex items-center gap-1 align-middle max-w-full">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{children}</TooltipTrigger>
          <TooltipContent side={side} align={align} className="text-xs">
            {breakdownContent}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {isMobile && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Show APY breakdown"
              onClick={(e) => e.stopPropagation()}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-[220px] p-3 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {breakdownContent}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
