import { Wallet, TrendingUp, PiggyBank, Shield } from "lucide-react";
import AssetSummary from "@/components/dashboard/AssetSummary";
import PnLBadge from "./PnLBadge";
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
  "oracle price, so gains from price moves are approximate. It does not model " +
  "impermanent loss, cost-basis lots, or a realized/unrealized split.";

const PortfolioOverviewHeader = ({ summary, showPnL }: Props) => {
  const { totalValueUsd, totalDebtUsd, totalInvestedUsd, totalUnrealizedUsd, totalUnrealizedPct, isLoading } =
    summary;

  return (
    <div
      className={`grid grid-cols-1 gap-3 md:gap-6 mb-4 md:mb-8 ${
        showPnL ? "lg:grid-cols-4" : "lg:grid-cols-2"
      }`}
    >
      <AssetSummary
        title="Total Portfolio Value"
        value={usd(totalValueUsd)}
        icon={<Wallet className="text-white" size={18} />}
        color="bg-blue-500"
        isLoading={isLoading}
      />

      {showPnL && (
        <AssetSummary
          title="Estimated P&L"
          value={totalUnrealizedUsd != null ? usd(totalUnrealizedUsd) : "—"}
          icon={<TrendingUp className="text-white" size={18} />}
          color="bg-emerald-500"
          isLoading={isLoading}
          tooltip={PNL_TOOLTIP}
          additionalContent={
            <PnLBadge valueUsd={totalUnrealizedUsd} pct={totalUnrealizedPct} showEmpty />
          }
        />
      )}

      {showPnL && (
        <AssetSummary
          title="Total Invested"
          value={totalInvestedUsd != null ? usd(totalInvestedUsd) : "—"}
          icon={<PiggyBank className="text-white" size={18} />}
          color="bg-purple-500"
          isLoading={isLoading}
          tooltip="Estimated net capital deposited (deposits minus withdrawals) across your positions."
        />
      )}

      <AssetSummary
        title="Total Borrowed"
        value={usd(totalDebtUsd)}
        icon={<Shield className="text-white" size={18} />}
        color="bg-orange-500"
        isLoading={isLoading}
        tooltip="Total outstanding debt across CDP vaults and the lending pool."
      />
    </div>
  );
};

export default PortfolioOverviewHeader;
