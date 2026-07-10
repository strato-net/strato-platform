import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import PnLBadge from "./PnLBadge";
import PortfolioPositionList from "./PortfolioPositionList";
import type { PortfolioGroup } from "@/interface/portfolio";

interface Props {
  groups: PortfolioGroup[];
  isLoading: boolean;
  showPnL: boolean;
}

const usd = (v: number): string =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PortfolioGroupList = ({ groups, isLoading, showPnL }: Props) => {
  // Expand the largest group by default; others collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    groups.length ? { [groups[0].key]: true } : {}
  );

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  if (isLoading && groups.length === 0) {
    return (
      <Card className="rounded-xl shadow-sm mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">Assets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card className="rounded-xl shadow-sm mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base md:text-lg">Assets</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No assets or positions yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl shadow-sm mb-6">
      <CardHeader className="pb-2 md:pb-4">
        <CardTitle className="text-base md:text-lg font-semibold">Assets by Underlying</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 md:space-y-3 px-3 md:px-6">
        {groups.map((group) => {
          const isOpen = !!expanded[group.key];
          return (
            <div key={group.key} className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className="w-full grid grid-cols-12 gap-2 items-center bg-muted/30 hover:bg-muted/50 transition-colors px-3 md:px-4 py-3 text-left"
              >
                <div className="col-span-5 md:col-span-4 min-w-0">
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronUp size={16} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-semibold text-sm md:text-base truncate">{group.label}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {group.positions.length}
                    </span>
                  </div>
                </div>

                <div className="hidden md:block md:col-span-2 text-right text-sm text-muted-foreground tabular-nums">
                  {group.allocationPct.toFixed(1)}%
                </div>

                <div className="hidden md:block md:col-span-2 text-right text-sm text-muted-foreground tabular-nums">
                  {group.blendedApy != null ? `${group.blendedApy.toFixed(2)}%` : "—"}
                </div>

                <div
                  className={`col-span-4 ${
                    showPnL ? "md:col-span-2" : "md:col-span-4"
                  } text-right`}
                >
                  <div className="font-semibold text-sm md:text-base tabular-nums">
                    {usd(group.totalValueUsd)}
                  </div>
                  {group.debtUsd > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {usd(group.grossValueUsd)} − {usd(group.debtUsd)} debt
                    </div>
                  )}
                </div>

                {showPnL && (
                  <div className="col-span-3 md:col-span-2 flex justify-end">
                    <PnLBadge valueUsd={group.unrealizedUsd} pct={group.unrealizedPct} showEmpty />
                  </div>
                )}
              </button>

              {isOpen && (
                <div className="px-1 md:px-2 pb-2 bg-background">
                  <PortfolioPositionList positions={group.positions} showPnL={showPnL} />
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default PortfolioGroupList;
