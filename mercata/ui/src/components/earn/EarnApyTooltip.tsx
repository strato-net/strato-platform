import { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  if (!info || info.breakdown.length === 0) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align} className="text-xs">
          <div className="flex flex-col gap-1">
            {info.breakdown.map((item) => (
              <div key={item.label} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{item.label}:</span>
                <span className="font-medium">{item.apy}%</span>
              </div>
            ))}
            {info.breakdown.length > 1 && (
              <div className="flex justify-between gap-4 border-t border-border/50 pt-1">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-medium">{info.total.toFixed(2)}%</span>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
