import { Row } from "./LoopRow";
import { formatPct, formatFeeBps, formatWeiCompact } from "./loopFormat";

interface LoopOverviewProps {
  assetSymbol: string;
  borrowSymbol: string;
  liquidityText: string;
  maxLeverageDisplay: string;
  maxLeverageAPY: number;
  maxLtvRatio: number;
  liquidationLtvRatio: number;
  oraclePrice: number;
  baseYieldAPR: number;
  stabilityAPR: number;
  swapFeeBps: number;
  debtFloor: string;
  debtCeiling: string;
}

const LoopOverview = ({
  assetSymbol,
  borrowSymbol,
  liquidityText,
  maxLeverageDisplay,
  maxLeverageAPY,
  maxLtvRatio,
  liquidationLtvRatio,
  oraclePrice,
  baseYieldAPR,
  stabilityAPR,
  swapFeeBps,
  debtFloor,
  debtCeiling,
}: LoopOverviewProps) => (
  <div className="space-y-6">
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-2">Liquidity Available</p>
        <p className="text-2xl font-bold tabular-nums">{liquidityText}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-2">Max Leverage</p>
        <p className="text-2xl font-bold tabular-nums">{maxLeverageDisplay}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-2">Max Leverage APY</p>
        <p className="text-2xl font-bold tabular-nums text-emerald-500">
          {formatPct(maxLeverageAPY)}
        </p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
      <Row label="Collateral Asset" value={assetSymbol} />
      <Row label="Debt Asset" value={borrowSymbol} />
      <Row label="Oracle Price" value={oraclePrice > 0 ? `$${oraclePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"} />
      <Row label="Base Yield" tip="Underlying yield of the collateral asset before leveraging" value={formatPct(baseYieldAPR)} />
      <Row label="Stability Fee" tip="Annual borrow rate charged on minted USDST debt" value={formatPct(stabilityAPR)} />
      <Row label="Swap Fee" tip="Pool fee per swap leg (applied twice per loop iteration)" value={formatFeeBps(swapFeeBps)} />
      <Row label="Max LTV" tip="Maximum loan-to-value ratio before position is at risk" value={formatPct(maxLtvRatio * 100)} />
      <Row label="Liquidation LTV" tip="LTV at which the position becomes eligible for liquidation" value={formatPct(liquidationLtvRatio * 100)} />
      <Row label="Debt Floor" tip="Minimum USDST debt required to open a position" value={`${formatWeiCompact(debtFloor)} ${borrowSymbol}`} />
      <Row label="Debt Ceiling" tip="Maximum total USDST debt allowed for this collateral" value={`${formatWeiCompact(debtCeiling)} ${borrowSymbol}`} />
    </div>
  </div>
);

export default LoopOverview;
