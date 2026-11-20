import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRate, rateToDecimal } from "@/utils/rewardsConverterMath";

/**
 * A raw 18-decimal rate in short form; hovering shows the full value. `bareWhole` shows a whole rate without
 * its decimal ("1").
 */
const RateValue = ({ rate, bareWhole = false }: { rate: string; bareWhole?: boolean }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-help">
        {bareWhole ? formatRate(BigInt(rate)).replace(/\.0$/, "") : formatRate(BigInt(rate))}
      </span>
    </TooltipTrigger>
    <TooltipContent className="font-mono text-xs">{rateToDecimal(BigInt(rate))}</TooltipContent>
  </Tooltip>
);

export default RateValue;
