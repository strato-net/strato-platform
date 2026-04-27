import { Row } from "./LoopRow";
import type { LoopPositionEntry } from "@mercata/shared-types";
import { formatBalance } from "@/utils/numberUtils";
import { formatPct, formatUsdFromWei } from "./loopFormat";
import { healthFactorColor } from "./loopMath";

interface LoopPositionProps {
  isLoggedIn: boolean;
  loading: boolean;
  position: LoopPositionEntry | null;
  assetSymbol: string;
  borrowSymbol: string;
  selectedAssetDecimals: number;
  liquidationLtvRatio: number;
}

const LoopPosition = ({
  isLoggedIn,
  loading,
  position,
  assetSymbol,
  borrowSymbol,
  selectedAssetDecimals,
  liquidationLtvRatio,
}: LoopPositionProps) => {
  if (!isLoggedIn) {
    return <p className="text-sm text-muted-foreground">Sign in to view your position.</p>;
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading position data...</p>;
  }
  if (!position) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No active position for {assetSymbol} on this route.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-2">Leverage</p>
          <p className="text-2xl font-bold tabular-nums">{position.leverage.toFixed(2)}x</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-2">Current APY</p>
          <p className={`text-2xl font-bold tabular-nums ${position.estimatedCarryAPR >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {formatPct(position.estimatedCarryAPR)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-2">Health Factor</p>
          <p className={`text-2xl font-bold tabular-nums ${healthFactorColor(position.healthFactor)}`}>
            {position.healthFactor.toFixed(2)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <Row
          label={`${assetSymbol} Supplied`}
          value={<>{formatBalance(position.collateral, undefined, selectedAssetDecimals, 4, 4)} <span className="text-muted-foreground">({formatUsdFromWei(position.collateralUSD)})</span></>}
        />
        <Row
          label={`${borrowSymbol} Borrowed`}
          value={<>{formatBalance(position.debt, undefined, 18, 4, 4)} <span className="text-muted-foreground">({formatUsdFromWei(position.debt)})</span></>}
        />
        <Row label="Position LTV" value={formatPct(position.effectiveLTV * 100)} valueClass="text-emerald-500" />
        <Row label="Liquidation LTV" value={formatPct(liquidationLtvRatio * 100)} valueClass="text-amber-500" />
        {position.collateralizationRatio > 0 && (
          <Row label="Collateralization Ratio" value={formatPct(position.collateralizationRatio)} />
        )}
      </div>
    </div>
  );
};

export default LoopPosition;
