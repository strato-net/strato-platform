import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import LPTokenDropdown from "@/components/dashboard/LPTokenDropdown";
import type { LPTokenDropdownProps } from "@/interface";
import type { PortfolioEarningRow } from "@/hooks/usePortfolioEarningRows";

type SortKey = "value" | "apy";

export default function PortfolioPositionsTable({
  rows,
  loading,
  guestMode,
  yieldDetailLoading,
}: {
  rows: PortfolioEarningRow[];
  loading: boolean;
  guestMode: boolean;
  /** APY / est. $/yr still loading (e.g. token-apys). */
  yieldDetailLoading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "value") {
        return b.valueUsd - a.valueUsd;
      }
      const apyA = a.apyTotal ?? -1;
      const apyB = b.apyTotal ?? -1;
      return apyB - apyA;
    });
    return copy;
  }, [rows, sortKey]);

  const toggleExpand = (addr: string) => {
    setExpanded((prev) => ({ ...prev, [addr]: !prev[addr] }));
  };

  if (loading && rows.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center text-muted-foreground text-sm">
        No earning positions yet. Deposit to start earning.
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="p-4 md:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border">
        <h2 className="font-bold text-lg">Earning positions</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Sort</span>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="value">Value</SelectItem>
              <SelectItem value="apy">Est. APY</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <th className="py-3 px-4">Asset / position</th>
              <th className="py-3 px-4 text-right">Value</th>
              <th className="py-3 px-4 text-right">Total est. APY</th>
              <th className="py-3 px-4 text-left">Yield breakdown</th>
              <th className="py-3 px-4 text-right">Est. $/yr</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedRows.map((row) => {
              const exp = !!expanded[row.asset.address];
              const pool = row.pool as LPTokenDropdownProps["lpToken"];
              const canExpand = row.isLPToken && pool;
              const yieldLoadingRow = yieldDetailLoading && row.valueUsd > 0;

              return (
                <Fragment key={row.asset.address}>
                  <tr className="hover:bg-muted/40">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={row.href}
                          className="font-medium text-blue-600 hover:text-blue-800 underline"
                        >
                          {row.asset._symbol || row.asset._name}
                        </Link>
                        {canExpand && (
                          <button
                            type="button"
                            className="p-0.5 hover:opacity-70"
                            onClick={() => toggleExpand(row.asset.address)}
                            aria-label={exp ? "Collapse" : "Expand"}
                          >
                            {exp ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-medium">
                      {guestMode || !row.valueUsd ? "—" : `$${row.valueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {yieldLoadingRow ? (
                        <Skeleton className="h-5 w-14 ml-auto" />
                      ) : row.apyInfo ? (
                        <EarnApyTooltip info={row.apyInfo}>
                          <span className="cursor-default font-semibold">
                            {row.apyTotal != null ? `${row.apyTotal.toFixed(2)}%` : "—"}
                          </span>
                        </EarnApyTooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground max-w-[220px]">
                      {yieldLoadingRow ? (
                        <Skeleton className="h-4 w-full max-w-[180px]" />
                      ) : row.apyInfo ? (
                        <EarnApyTooltip info={row.apyInfo}>
                          <span className="cursor-default line-clamp-2">{row.breakdownLabel}</span>
                        </EarnApyTooltip>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">
                      {guestMode ? (
                        "—"
                      ) : yieldLoadingRow ? (
                        <Skeleton className="h-5 w-20 ml-auto" />
                      ) : row.estAnnualUsd == null ? (
                        "—"
                      ) : (
                        `$${row.estAnnualUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={row.href}>Manage</Link>
                      </Button>
                    </td>
                  </tr>
                  {canExpand && (
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="p-0">
                        <LPTokenDropdown lpToken={pool} isExpanded={exp} className="px-4 pb-3" />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border">
        {sortedRows.map((row) => {
          const exp = !!expanded[`m-${row.asset.address}`];
          const pool = row.pool as LPTokenDropdownProps["lpToken"];
          const canExpand = row.isLPToken && pool;
          const yieldLoadingRow = yieldDetailLoading && row.valueUsd > 0;

          return (
            <div key={`m-${row.asset.address}`} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={row.href} className="font-semibold text-blue-600 underline">
                      {row.asset._symbol || row.asset._name}
                    </Link>
                    {canExpand && (
                      <button
                        type="button"
                        className="p-0.5"
                        onClick={() => toggleExpand(`m-${row.asset.address}`)}
                      >
                        {exp ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to={row.href}>Manage</Link>
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Value</p>
                  <p className="font-medium">
                    {guestMode || !row.valueUsd ? "—" : `$${row.valueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Est. APY</p>
                  {yieldLoadingRow ? (
                    <Skeleton className="h-5 w-14 mt-0.5" />
                  ) : (
                    <p className="font-medium">{row.apyTotal != null ? `${row.apyTotal.toFixed(2)}%` : "—"}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground text-xs">Breakdown</p>
                  {yieldLoadingRow ? (
                    <Skeleton className="h-4 w-full mt-0.5" />
                  ) : (
                    <p className="text-xs line-clamp-3">{row.breakdownLabel}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Est. $/yr</p>
                  {guestMode ? (
                    <p className="font-medium">—</p>
                  ) : yieldLoadingRow ? (
                    <Skeleton className="h-5 w-20 mt-0.5" />
                  ) : (
                    <p className="font-medium">
                      {row.estAnnualUsd == null
                        ? "—"
                        : `$${row.estAnnualUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </p>
                  )}
                </div>
              </div>
              {canExpand && (
                <LPTokenDropdown lpToken={pool} isExpanded={exp} className="pt-1" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
