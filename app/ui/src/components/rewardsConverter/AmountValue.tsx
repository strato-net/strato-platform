import type { RewardsConverterToken } from "@strato/shared-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBalance, formatUnits } from "@/utils/numberUtils";
import { formatFraction } from "@/utils/rewardsConverterMath";

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
          : formatBalance(raw, token.symbol, token.decimals, 2, 6)}
      </span>
    </TooltipTrigger>
    <TooltipContent className="font-mono text-xs">
      {formatUnits(raw, token.decimals)} {token.symbol}
    </TooltipContent>
  </Tooltip>
);

export default AmountValue;
