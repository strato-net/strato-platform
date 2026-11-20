import type { ReactNode } from "react";
import { Info, Loader2 } from "lucide-react";
import type { RewardsConverterAdminStats, RewardsConverterInfo } from "@strato/shared-types";
import { truncateAddress } from "@/utils/numberUtils";
import { formatRate, rateToDecimal } from "@/utils/rewardsConverterMath";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import CopyButton from "@/components/ui/copy";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTokenAmount } from "./formatTokenAmount";

const Hover = ({ tip, children }: { tip: string; children: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex items-center gap-1 cursor-help">{children}</span>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">
      <p>{tip}</p>
    </TooltipContent>
  </Tooltip>
);

const Stat = ({ label, tip, children }: { label: string; tip: string; children: ReactNode }) => (
  <Card className="border border-border/70">
    <CardContent className="pt-4 space-y-2">
      <div className="text-xs text-muted-foreground">
        <Hover tip={tip}>
          {label}
          <Info className="h-3 w-3" />
        </Hover>
      </div>
      <div className="text-lg font-semibold">{children}</div>
    </CardContent>
  </Card>
);

const ConverterNumbers = ({ state, stats }: {
  state: RewardsConverterInfo;
  stats: RewardsConverterAdminStats | undefined;
}) => {
  const { rewardsToken, stratoToken } = state;
  const loading = <Loader2 className="inline h-4 w-4 animate-spin" />;
  const rate = BigInt(state.rate);
  const rateUnit = `${stratoToken.symbol} per Rewards Point`;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Stat label="Rate" tip={`${stratoToken.symbol} paid for each Rewards Point converted. Changed by a governed call.`}>
        <Hover tip={`${rateToDecimal(rate)} ${rateUnit}`}>{formatRate(rate)} {rateUnit}</Hover>
      </Stat>
      <Stat label="Status" tip="Whether holders can convert right now. While paused, every conversion is rejected.">
        <Badge variant={state.paused ? "destructive" : "default"}>{state.paused ? "Paused" : "Active"}</Badge>
      </Stat>
      <Stat label="Reserve" tip={`${stratoToken.symbol} the converter holds to pay conversions.`}>{formatTokenAmount(state.reserve, stratoToken)}</Stat>
      <Stat
        label="Max Convertible"
        tip={`The most ${rewardsToken.symbol} the reserve can pay for at the current rate. This limit is shared by all holders.`}
      >
        {formatTokenAmount(state.maxConvertible, rewardsToken)}
      </Stat>
      <Stat label="Converter Address" tip="The converter contract's address on this network.">
        <div className="flex items-center gap-1">
          {truncateAddress(state.address)}
          <CopyButton address={state.address} />
        </div>
      </Stat>
      <Stat label="Total Burned" tip={`${rewardsToken.symbol} burned by all conversions so far.`}>{stats ? formatTokenAmount(stats.totalBurned, rewardsToken) : loading}</Stat>
      <Stat label={`Total ${stratoToken.symbol} Paid`} tip={`${stratoToken.symbol} paid out from the reserve by all conversions so far.`}>{stats ? formatTokenAmount(stats.totalPaid, stratoToken) : loading}</Stat>
      <Stat label="Outstanding Supply" tip={`${rewardsToken.symbol} in existence: everything not yet converted and burned.`}>{stats ? formatTokenAmount(stats.outstandingSupply, rewardsToken) : loading}</Stat>
      <Stat
        label="Total Funded (net of withdrawals)"
        tip={`${stratoToken.symbol} put into the reserve minus reserve withdrawals.`}
      >
        {stats ? (
          <Hover tip={`Withdrawn: ${formatTokenAmount(stats.totalWithdrawn, stratoToken)}`}>
            {formatTokenAmount(stats.totalFunded, stratoToken)}
          </Hover>
        ) : loading}
      </Stat>
    </div>
  );
};

export default ConverterNumbers;
