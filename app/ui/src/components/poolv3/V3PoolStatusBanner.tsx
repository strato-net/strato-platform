import { AlertTriangle, Ban } from "lucide-react";
import { PoolV3 } from "@/interface";
import { cn } from "@/lib/utils";

/**
 * Status banner for a PoolV3 that is paused or disabled; renders nothing for a
 * healthy pool. Shared by the Pools browser and the My Positions tab so both
 * places describe the same states identically. Disabled takes precedence.
 *
 * Note: disabled pools are hidden from the Pools browser entirely, so there the
 * banner only ever shows the paused state — but My Positions keeps a user's own
 * positions visible, so it can surface either.
 */
const V3PoolStatusBanner = ({ pool, className }: { pool: PoolV3; className?: string }) => {
  if (pool.isDisabled) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive",
          className
        )}
      >
        <Ban className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="text-xs">
          <p className="font-medium">This pool is disabled</p>
          <p className="opacity-80">
            Adding liquidity, withdrawals, and fee collection are turned off for this pool.
          </p>
        </div>
      </div>
    );
  }
  if (pool.isPaused) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border border-yellow-600/40 bg-yellow-500/10 p-3 text-yellow-700 dark:text-yellow-500",
          className
        )}
      >
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="text-xs">
          <p className="font-medium">This pool is paused</p>
          <p className="opacity-80">
            Adding liquidity is temporarily disabled. You can still remove liquidity and collect fees.
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export default V3PoolStatusBanner;
