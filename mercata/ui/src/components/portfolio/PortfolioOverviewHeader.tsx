import { Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import PnLBadge from "./PnLBadge";
import PortfolioValueSparkline from "./PortfolioValueSparkline";
import type { PortfolioSummary } from "@/interface/portfolio";

interface Props {
  summary: PortfolioSummary;
  /** P&L is only meaningful for a logged-in user with activity history. */
  showPnL: boolean;
}

const usd = (v: number): string =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PNL_TOOLTIP =
  "Estimated P&L is derived from your on-chain deposit/withdrawal history " +
  "(net invested vs. current value). Non-USD flows are valued at the current " +
  "oracle price, so gains from price moves are approximate.";

const Stat = ({
  label,
  value,
  tooltip,
  valueClassName,
  isLoading,
}: {
  label: string;
  value: string;
  tooltip?: string;
  valueClassName?: string;
  isLoading: boolean;
}) => (
  <div className="min-w-0">
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="truncate">{label}</span>
      {tooltip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-3 w-3 cursor-help opacity-70 hover:opacity-100 shrink-0" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-sm">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
    {isLoading ? (
      <Skeleton className="h-6 w-20 mt-1" />
    ) : (
      <div className={`text-base md:text-lg font-semibold tabular-nums mt-0.5 ${valueClassName ?? ""}`}>
        {value}
      </div>
    )}
  </div>
);

const PortfolioOverviewHeader = ({ summary, showPnL }: Props) => {
  const {
    totalValueUsd,
    totalGrossUsd,
    totalDebtUsd,
    totalInvestedUsd,
    totalUnrealizedUsd,
    totalUnrealizedPct,
    isLoading,
  } = summary;

  return (
    <Card className="rounded-xl shadow-sm h-full">
      <div className="flex h-full flex-col justify-between gap-6 p-5 md:p-6">
        {/* Hero: total value + P&L */}
        <div>
          <div className="flex items-start justify-between">
            <span className="text-sm text-muted-foreground">Total Portfolio Value</span>
            <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
              <Wallet className="text-white" size={18} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-10 w-48 mt-2" />
          ) : (
            <div className="text-3xl md:text-4xl font-bold tabular-nums mt-1">
              {usd(totalValueUsd)}
            </div>
          )}
          {showPnL && (
            <div className="mt-2">
              <PnLBadge valueUsd={totalUnrealizedUsd} pct={totalUnrealizedPct} size="lg" showEmpty />
            </div>
          )}
        </div>

        {/* Value trend sparkline fills the middle */}
        {!isLoading && (
          <PortfolioValueSparkline
            currentValue={totalValueUsd}
            positive={(totalUnrealizedUsd ?? 0) >= 0}
            enabled={!isLoading}
          />
        )}

        {/* Secondary stats pinned to the bottom */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
          <Stat label="Asset Value" value={usd(totalGrossUsd)} isLoading={isLoading} />
          <Stat
            label="Total Invested"
            value={showPnL && totalInvestedUsd != null ? usd(totalInvestedUsd) : "—"}
            tooltip={showPnL ? "Estimated net capital deposited (deposits minus withdrawals)." : undefined}
            isLoading={isLoading}
          />
          <Stat
            label="Est. Return"
            value={showPnL && totalUnrealizedPct != null ? `${totalUnrealizedPct > 0 ? "+" : ""}${totalUnrealizedPct.toFixed(2)}%` : "—"}
            tooltip={showPnL ? PNL_TOOLTIP : undefined}
            valueClassName={
              showPnL && totalUnrealizedUsd != null
                ? totalUnrealizedUsd > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : totalUnrealizedUsd < 0
                    ? "text-red-600 dark:text-red-400"
                    : ""
                : ""
            }
            isLoading={isLoading}
          />
          <Stat
            label="Total Borrowed"
            value={usd(totalDebtUsd)}
            tooltip="Total outstanding debt across CDP vaults and the lending pool."
            isLoading={isLoading}
          />
        </div>
      </div>
    </Card>
  );
};

export default PortfolioOverviewHeader;
