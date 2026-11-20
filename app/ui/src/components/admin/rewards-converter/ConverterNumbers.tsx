import type { ReactNode } from "react";
import { Info, Loader2 } from "lucide-react";
import type { RewardsConverterAdminStats, RewardsConverterInfo } from "@strato/shared-types";
import { truncateAddress } from "@/utils/numberUtils";
import { formatRate, formatShare, rateToDecimal, shareToDecimal } from "@/utils/rewardsConverterMath";
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
  const maxConvertible = BigInt(state.maxConvertible);
  const supply = BigInt(stats?.outstandingSupply ?? 0);
  const rateUnit = `${stratoToken.symbol} / Point`;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Stat label="Rate" tip={`${stratoToken.symbol} paid for each Rewards Point converted. Changed by a governed call.`}>
        <Hover tip={`${rateToDecimal(rate)} ${rateUnit}`}>{formatRate(rate)} {rateUnit}</Hover>
      </Stat>
      <Stat
        label="Reserve"
        tip={`${stratoToken.symbol} the converter holds to pay conversions. Coverage is the share of the outstanding ${rewardsToken.symbol} the reserve can pay for at the current rate. This limit is shared by all holders.`}
      >
        {stats ? (
          <Hover tip={`Total funded (net of withdrawals): ${formatTokenAmount(stats.totalFunded, stratoToken)}`}>
            {formatTokenAmount(state.reserve, stratoToken)}
          </Hover>
        ) : formatTokenAmount(state.reserve, stratoToken)}
        <div className="mt-2">
          <div className="text-xs font-normal text-muted-foreground">Coverage</div>
          {stats ? (
            <Hover tip={shareToDecimal(maxConvertible, supply)}>{formatShare(maxConvertible, supply)}</Hover>
          ) : loading}
        </div>
      </Stat>
      <Card className="border border-border/70">
        <CardContent className="pt-4 space-y-2 text-lg font-semibold">
          {[{ symbol: "Converter", address: state.address }, rewardsToken, stratoToken].map(({ symbol, address }) => (
            <div key={address}>
              <div className="text-xs font-normal text-muted-foreground">{symbol}</div>
              <div className="flex items-center gap-1">
                {truncateAddress(address)}
                <CopyButton address={address} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Stat
        label="Conversion Totals"
        tip={`${rewardsToken.symbol} burned and ${stratoToken.symbol} paid out from the reserve by all conversions so far.`}
      >
        <div className="space-y-2">
          {[
            { label: "Burned", amount: stats?.totalBurned, token: rewardsToken },
            { label: "Paid", amount: stats?.totalPaid, token: stratoToken },
          ].map(({ label, amount, token }) => (
            <div key={label}>
              <div className="text-xs font-normal text-muted-foreground">{label}</div>
              {amount ? formatTokenAmount(amount, token) : loading}
            </div>
          ))}
        </div>
      </Stat>
    </div>
  );
};

export default ConverterNumbers;
