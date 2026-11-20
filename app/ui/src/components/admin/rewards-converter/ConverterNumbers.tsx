import type { ReactNode } from "react";
import { HelpCircle, Loader2 } from "lucide-react";
import type { RewardsConverterAdminStats, RewardsConverterInfo } from "@strato/shared-types";
import { truncateAddress } from "@/utils/numberUtils";
import { formatCoverage, formatRate, rateToDecimal } from "@/utils/rewardsConverterMath";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import CopyButton from "@/components/ui/copy";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTokenAmount } from "./formatTokenAmount";

const Stat = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <Card className="border border-border/70">
    <CardContent className="pt-4 space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{children}</div>
    </CardContent>
  </Card>
);

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
      <Stat label="Rate">
        <Hover tip={`${rateToDecimal(rate)} ${rateUnit}`}>{formatRate(rate)} {rateUnit}</Hover>
      </Stat>
      <Stat label="Status">
        <Badge variant={state.paused ? "destructive" : "default"}>{state.paused ? "Paused" : "Active"}</Badge>
      </Stat>
      <Stat label="Reserve">{formatTokenAmount(state.reserve, stratoToken)}</Stat>
      <Stat
        label={
          <Hover tip={`The most ${rewardsToken.symbol} the reserve can pay for at the current rate. This limit is shared by all holders.`}>
            Max Convertible
            <HelpCircle className="h-3 w-3" />
          </Hover>
        }
      >
        {formatTokenAmount(state.maxConvertible, rewardsToken)}
      </Stat>
      <Stat label="Converter Address">
        <div className="flex items-center gap-1">
          {truncateAddress(state.address)}
          <CopyButton address={state.address} />
        </div>
      </Stat>
      <Stat label="Total Burned">{stats ? formatTokenAmount(stats.totalBurned, rewardsToken) : loading}</Stat>
      <Stat label={`Total ${stratoToken.symbol} Paid`}>{stats ? formatTokenAmount(stats.totalPaid, stratoToken) : loading}</Stat>
      <Stat label="Outstanding Supply">{stats ? formatTokenAmount(stats.outstandingSupply, rewardsToken) : loading}</Stat>
      <Stat label="Coverage">{stats ? formatCoverage(stats.coverage) : loading}</Stat>
      <Stat label="Total Funded (net of withdrawals)">
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
