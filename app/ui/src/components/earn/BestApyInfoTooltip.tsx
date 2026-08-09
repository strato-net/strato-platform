import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";

export const BEST_APY_TOOLTIP_TEXT =
  "Estimated total yield available for this asset, combining native yield, pool/base yield, and rewards. Reward points can be claimed now and convert into tangible value at TGE. Actual returns may vary over time.";

interface BestApyInfoTooltipProps {
  className?: string;
  iconClassName?: string;
}

export const BestApyInfoTooltip = ({
  className,
  iconClassName = "h-3 w-3 text-muted-foreground",
}: BestApyInfoTooltipProps) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip(
    "best-apy-info-tooltip-container"
  );

  if (isMobile) {
    return (
      <span
        className={`best-apy-info-tooltip-container inline-flex ${className || ""}`}
      >
        <Info
          className={`${iconClassName} cursor-pointer`}
          onClick={handleToggle}
        />
        {showTooltip &&
          createPortal(
            <>
              <div className="best-apy-info-tooltip-container fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] bg-popover border rounded-lg px-4 py-3 text-sm text-popover-foreground shadow-lg max-w-[85vw] w-[320px]">
                <div className="text-center whitespace-pre-line">
                  {BEST_APY_TOOLTIP_TEXT}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(e);
                  }}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground text-lg leading-none"
                >
                  <span className="sr-only">Close</span>
                  ×
                </button>
              </div>
              <div
                className="fixed inset-0 z-[99] bg-black/20"
                onClick={handleToggle}
              />
            </>,
            document.body
          )}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className={`${iconClassName} cursor-help ${className || ""}`} />
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">{BEST_APY_TOOLTIP_TEXT}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export default BestApyInfoTooltip;
