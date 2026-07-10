import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PnLBadgeProps {
  /** Absolute USD gain/loss. `null` when P&L is unavailable. */
  valueUsd?: number | null;
  /** Percentage gain/loss. */
  pct?: number | null;
  /** "sm" for inline rows, "lg" for headline figures. */
  size?: "sm" | "lg";
  className?: string;
  /** Render a dash when P&L is unavailable instead of nothing. */
  showEmpty?: boolean;
}

const fmtUsd = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const PnLBadge = ({ valueUsd, pct, size = "sm", className, showEmpty }: PnLBadgeProps) => {
  if (valueUsd == null && pct == null) {
    return showEmpty ? <span className="text-muted-foreground">—</span> : null;
  }

  const basis = valueUsd ?? 0;
  const positive = basis > 0;
  const negative = basis < 0;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium tabular-nums",
        size === "lg" ? "text-lg md:text-xl" : "text-sm",
        positive && "text-emerald-600 dark:text-emerald-400",
        negative && "text-red-600 dark:text-red-400",
        !positive && !negative && "text-muted-foreground",
        className
      )}
    >
      {Icon && <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />}
      {valueUsd != null && <span>{fmtUsd(valueUsd)}</span>}
      {pct != null && (
        <span className="opacity-80">
          ({pct > 0 ? "+" : ""}
          {pct.toFixed(2)}%)
        </span>
      )}
    </span>
  );
};

export default PnLBadge;
