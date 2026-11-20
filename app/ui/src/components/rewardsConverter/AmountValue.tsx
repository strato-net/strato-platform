import type { RewardsConverterToken } from "@strato/shared-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatUnits } from "@/utils/numberUtils";
import { formatAmount, formatFraction } from "@/utils/rewardsConverterMath";

/**
 * A raw token amount with its symbol; hovering shows the full value. Under one whole token it is in short
 * form, since 6 decimals can read as zero.
 */
const AmountValue = ({ raw, token }: { raw: bigint; token: RewardsConverterToken }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="cursor-help">
        {raw < 10n ** BigInt(token.decimals)
          ? `${formatFraction(raw, token.decimals)} ${token.symbol}`
          : formatAmount(raw, token, 6)}
      </span>
    </TooltipTrigger>
    <TooltipContent className="font-mono text-xs">
      {formatUnits(raw, token.decimals)} {token.symbol}
    </TooltipContent>
  </Tooltip>
);

export default AmountValue;
