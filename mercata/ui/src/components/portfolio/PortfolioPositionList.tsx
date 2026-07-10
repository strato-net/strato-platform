import { Link } from "react-router-dom";
import { formatBalance } from "@/utils/numberUtils";
import PnLBadge from "./PnLBadge";
import type { PortfolioPosition, PositionKind } from "@/interface/portfolio";

const KIND_LABELS: Record<PositionKind, string> = {
  holding: "Holding",
  cdpCollateral: "Vault Collateral",
  cdpDebt: "Vault Debt",
  loan: "Loan",
  lendingSupply: "Supplied",
  saveVault: "Save Vault",
  carryVault: "Carry Vault",
  yieldVault: "Yield Vault",
  lpPool: "LP Position",
  safetyStake: "Safety Stake",
};

const usd = (v: number): string => {
  const abs = Math.abs(v);
  return `${v < 0 ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

interface Props {
  positions: PortfolioPosition[];
  showPnL: boolean;
}

const PortfolioPositionList = ({ positions, showPnL }: Props) => {
  return (
    <div className="divide-y divide-border">
      {/* header row */}
      <div className="grid grid-cols-12 gap-2 px-2 py-2 text-xs font-medium text-muted-foreground">
        <div className="col-span-5 md:col-span-4">Position</div>
        <div className="col-span-4 md:col-span-3 text-right">Balance</div>
        <div className="hidden md:block md:col-span-2 text-right">APY</div>
        <div className={`col-span-3 ${showPnL ? "md:col-span-1" : "md:col-span-3"} text-right`}>Value</div>
        {showPnL && <div className="hidden md:block md:col-span-2 text-right">Est. P&L</div>}
      </div>

      {positions.map((p) => {
        const isLiability = p.valueUsd < 0;
        const balanceLabel = formatBalance(p.balanceRaw || "0", undefined, p.decimals || 18, 2, 4);
        const nameNode = (
          <span className="font-medium text-sm text-foreground truncate">{p.symbol}</span>
        );

        return (
          <div key={p.id} className="grid grid-cols-12 gap-2 px-2 py-3 items-center">
            <div className="col-span-5 md:col-span-4 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="h-5 w-5 rounded-full shrink-0 object-cover"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                ) : null}
                <div className="min-w-0">
                  {p.href ? (
                    <Link to={p.href} className="hover:underline truncate block">
                      {nameNode}
                    </Link>
                  ) : (
                    nameNode
                  )}
                  <div className="text-[11px] text-muted-foreground leading-none mt-0.5">
                    {KIND_LABELS[p.kind]}
                    {p.healthFactor != null && ` · HF ${p.healthFactor.toFixed(2)}`}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-4 md:col-span-3 text-right text-sm tabular-nums text-foreground">
              {isLiability ? `-${balanceLabel}` : balanceLabel}
            </div>

            <div className="hidden md:block md:col-span-2 text-right text-sm tabular-nums text-muted-foreground">
              {p.apy != null ? `${p.apy.toFixed(2)}%` : "—"}
            </div>

            <div
              className={`col-span-3 ${
                showPnL ? "md:col-span-1" : "md:col-span-3"
              } text-right text-sm font-semibold tabular-nums ${
                isLiability ? "text-red-600 dark:text-red-400" : "text-foreground"
              }`}
            >
              {usd(p.valueUsd)}
            </div>

            {showPnL && (
              <div className="hidden md:flex md:col-span-2 justify-end">
                <PnLBadge valueUsd={p.unrealizedUsd} pct={p.unrealizedPct} showEmpty />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PortfolioPositionList;
