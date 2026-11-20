import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRate, rateToDecimal } from "@/utils/rewardsConverterMath";

/** A raw 18-decimal rate in short form; hovering shows the full value. */
const RateValue = ({ rate }: { rate: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-help">{formatRate(BigInt(rate))}</span>
    </TooltipTrigger>
    <TooltipContent className="font-mono text-xs">{rateToDecimal(BigInt(rate))}</TooltipContent>
  </Tooltip>
);

export default RateValue;
