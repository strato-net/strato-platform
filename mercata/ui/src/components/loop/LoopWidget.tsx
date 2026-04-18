import { useMemo, useState } from "react";
import { formatUnits, formatBalance, parseUnitsWithTruncation, safeParseUnits } from "@/utils/numberUtils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import type { LoopRouteOpportunity, LoopPositionEntry } from "@mercata/shared-types";
import { handleAmountInputChange } from "@/utils/transferValidation";
import { LOOP_FEE } from "@/lib/constants";
import { Row, ExpandableRow, InfoTip } from "./LoopRow";
import { formatPct, formatFeeBps, formatCompact } from "./loopFormat";
import { healthFactorColor, projectLoopedPosition } from "./loopMath";

const SLIPPAGE_OPTIONS = [50, 100, 200] as const;

const parseWei = (wei: string | undefined, decimals: number): number => {
  if (!wei) return 0;
  try { return Number(formatUnits(wei, decimals)); } catch { return 0; }
};

const SlippageButton = ({
  bps,
  active,
  onClick,
}: {
  bps: number;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/80"
    }`}
  >
    {(bps / 100).toFixed(1)}%
  </button>
);

interface LoopWidgetProps {
  isLoggedIn: boolean;
  selectedOpportunity: LoopRouteOpportunity | null;
  assetSymbol: string;
  borrowSymbol: string;
  selectedAssetDecimals: number;
  selectedAssetPrice: number;
  selectedTokenBalanceWei: string;
  usdstBalanceWei: string;
  leverageSliderMin: number;
  leverageSliderMax: number;
  liquidationLtvRatio: number;
  assetStabilityAPR: number;
  poolSwapFeeBps: number;
  collateralAmount: string;
  onCollateralAmountChange: (value: string) => void;
  leverage: number;
  onLeverageChange: (value: number) => void;
  currentPosition: LoopPositionEntry | null;
  canExecute: boolean;
  onExecute: (args: { amount: string; targetLeverage: number; maxSlippageBps: number }) => Promise<void>;
  onExecuted: () => void | Promise<void>;
}

const LoopWidget = ({
  isLoggedIn,
  selectedOpportunity,
  assetSymbol,
  borrowSymbol,
  selectedAssetDecimals,
  selectedAssetPrice,
  selectedTokenBalanceWei,
  usdstBalanceWei,
  leverageSliderMin,
  leverageSliderMax,
  liquidationLtvRatio,
  assetStabilityAPR,
  poolSwapFeeBps,
  collateralAmount,
  onCollateralAmountChange,
  leverage,
  onLeverageChange,
  currentPosition,
  canExecute,
  onExecute,
  onExecuted,
}: LoopWidgetProps) => {
  const { toast } = useToast();
  const [amountError, setAmountError] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [exposureOpen, setExposureOpen] = useState(false);
  const [apyOpen, setApyOpen] = useState(false);
  const [liquidationOpen, setLiquidationOpen] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);

  const maxBalanceWei = useMemo(() => {
    try { return BigInt(selectedTokenBalanceWei || "0"); } catch { return 0n; }
  }, [selectedTokenBalanceWei]);

  const formattedWalletBalance = useMemo(
    () => formatBalance(selectedTokenBalanceWei, assetSymbol || undefined, selectedAssetDecimals, 2, 6),
    [assetSymbol, selectedAssetDecimals, selectedTokenBalanceWei]
  );

  const loopFeeWei = safeParseUnits(LOOP_FEE);

  const computedAmountError = useMemo(() => {
    if (!collateralAmount) return "";
    if (amountError) return amountError;
    try {
      const weiAmount = parseUnitsWithTruncation(collateralAmount, selectedAssetDecimals);
      if (weiAmount <= 0n) return "Amount must be greater than 0";
      if (maxBalanceWei <= 0n || weiAmount > maxBalanceWei) return "Maximum amount exceeded";
      if (BigInt(usdstBalanceWei || "0") < loopFeeWei) return "Insufficient USDST for transaction fee";
      return "";
    } catch {
      return "Invalid input format";
    }
  }, [amountError, collateralAmount, selectedAssetDecimals, maxBalanceWei, usdstBalanceWei, loopFeeWei]);

  const hasValidAmount = Boolean(collateralAmount) && !computedAmountError;

  const handleAmountChange = (value: string) => {
    handleAmountInputChange(value, onCollateralAmountChange, setAmountError, selectedTokenBalanceWei, selectedAssetDecimals);
  };

  const setFromBalanceRatio = (numerator: number, denominator: number) => {
    if (maxBalanceWei <= 0n) return;
    const targetWei = (maxBalanceWei * BigInt(numerator)) / BigInt(denominator);
    handleAmountChange(formatUnits(targetWei, selectedAssetDecimals));
  };

  const collateralAmountNumber = Math.max(0, Number.parseFloat(collateralAmount || "0") || 0);

  const hasPosition = currentPosition !== null;
  const currentLeverage = currentPosition?.leverage ?? 0;
  const currentAPY = currentPosition?.estimatedCarryAPR ?? 0;

  const currentCollateralTokens = parseWei(currentPosition?.collateral, selectedAssetDecimals);
  const currentDebtUsd = parseWei(currentPosition?.debt, 18);

  const projection = useMemo(() => projectLoopedPosition({
    currentCollateralTokens,
    currentDebtUsd,
    addPrincipalTokens: collateralAmountNumber,
    targetLeverage: leverage,
    priceUsd: selectedAssetPrice,
  }), [currentCollateralTokens, currentDebtUsd, collateralAmountNumber, leverage, selectedAssetPrice]);

  const { finalCollateralTokens, finalCollateralUsd, finalDebtUsd, finalLeverage, finalLtv } = projection;

  const { projectedNetSupplyApy, breakEvenDays, entryCostPct } = useMemo(() => {
    if (!selectedOpportunity || finalLeverage <= 1) return { projectedNetSupplyApy: 0, breakEvenDays: 0, entryCostPct: 0 };
    const { baseYieldAPR: baseYield, swapPoolUSDSTLiquidity } = selectedOpportunity;
    const gross = finalLeverage * baseYield - (finalLeverage - 1) * assetStabilityAPR;
    const feePerLeg = poolSwapFeeBps / 10000;
    const poolReserve = Number(formatUnits(swapPoolUSDSTLiquidity || "0", 18));
    const swapUsd = projection.newDebtUsd;
    const addPrincipalUsd = collateralAmountNumber * selectedAssetPrice;
    const g = 1 - feePerLeg;
    const impact = poolReserve > 0 && swapUsd > 0 ? (g * swapUsd) / (poolReserve + g * swapUsd) : 0;
    const net = Math.round(gross * 1000) / 1000;
    const legRatio = addPrincipalUsd > 0 ? swapUsd / addPrincipalUsd : 0;
    const cost = Math.round(legRatio * (feePerLeg + impact) * 100 * 1000) / 1000;
    const days = net > 0 ? Math.ceil((cost / net) * 365) : 0;
    return { projectedNetSupplyApy: net, breakEvenDays: days, entryCostPct: cost };
  }, [selectedOpportunity, finalLeverage, collateralAmountNumber, selectedAssetPrice, assetStabilityAPR, poolSwapFeeBps, projection.newDebtUsd]);

  const projectedLiquidationPrice =
    liquidationLtvRatio > 0 && selectedAssetPrice > 0 && finalLtv > 0
      ? (selectedAssetPrice * finalLtv) / liquidationLtvRatio
      : 0;

  const projectedLiquidationMovePct =
    selectedAssetPrice > 0
      ? ((projectedLiquidationPrice - selectedAssetPrice) / selectedAssetPrice) * 100
      : 0;

  const projectedHealthFactor =
    finalLtv > 0 && liquidationLtvRatio > 0
      ? Math.round((liquidationLtvRatio / finalLtv) * 100) / 100
      : 0;

  const atMaxLeverage = leverageSliderMin > leverageSliderMax;

  const runExecute = async () => {
    if (!isLoggedIn || !canExecute || !hasValidAmount) return;
    setExecuteLoading(true);
    try {
      const amountWei = parseUnitsWithTruncation(collateralAmount, selectedAssetDecimals).toString();
      await onExecute({ amount: amountWei, targetLeverage: leverage, maxSlippageBps: slippageBps });
      toast({ title: "Loop executed", variant: "success" });
      onCollateralAmountChange("");
      await onExecuted();
    } catch (err: any) {
      toast({ title: "Loop failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setExecuteLoading(false);
    }
  };

  return (
    <Card className="border-border bg-card/80 h-fit xl:order-1">
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-base font-medium text-foreground">
                {assetSymbol || "—"}
              </span>
              <Input
                id="loop-size"
                value={collateralAmount}
                onChange={(event) => handleAmountChange(event.target.value)}
                placeholder="0.00"
                disabled={!isLoggedIn}
                className="h-8 border-0 bg-transparent px-0 pl-16 text-right text-3xl font-semibold shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Balance: {formattedWalletBalance}</span>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setFromBalanceRatio(1, 2)} disabled={!isLoggedIn}>Half</Button>
                <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setFromBalanceRatio(1, 1)} disabled={!isLoggedIn}>Max</Button>
              </div>
            </div>
          </div>
          {computedAmountError && <p className="text-xs text-red-500">{computedAmountError}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="loop-leverage">Leverage</Label>
            <span className="inline-block w-12 text-right text-sm font-medium tabular-nums">{leverage.toFixed(1)}x</span>
          </div>
          <Slider
            id="loop-leverage"
            min={Math.min(leverageSliderMin, leverageSliderMax)}
            max={leverageSliderMax}
            step={0.1}
            value={[leverage]}
            onValueChange={(value) => onLeverageChange(value[0] ?? leverage)}
            disabled={!isLoggedIn || atMaxLeverage}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{leverageSliderMin.toFixed(1)}x</span>
            <span className="inline-block w-12 text-right tabular-nums">{leverageSliderMax.toFixed(1)}x</span>
          </div>
          {atMaxLeverage && (
            <p className="text-xs text-amber-500">Position already at max leverage.</p>
          )}
        </div>

        <div className="space-y-1">
          <Button
            type="button"
            className="w-full"
            onClick={runExecute}
            disabled={!isLoggedIn || executeLoading || !canExecute || !hasValidAmount || atMaxLeverage}
          >
            {executeLoading ? "Processing..." : "Execute"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Actual leverage may vary within ~0.1% of target
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center">Slippage Tolerance<InfoTip text="Max price movement allowed per swap. Transaction reverts if exceeded." /></span>
            <div className="flex items-center gap-1">
              {SLIPPAGE_OPTIONS.map((bps) => (
                <SlippageButton key={bps} bps={bps} active={slippageBps === bps} onClick={() => setSlippageBps(bps)} />
              ))}
            </div>
          </div>
          <Row
            label="Swap Fee"
            tip="Pool fee charged on each swap leg during the loop"
            value={formatFeeBps(poolSwapFeeBps)}
          />
          <ExpandableRow
            label="Projected APY"
            tip="Your estimated annual return after borrow costs, swap fees, and pool impact at your current amount and leverage"
            open={apyOpen}
            onOpenChange={setApyOpen}
            summary={
              <>
                {hasPosition ? formatPct(currentAPY) : "0.00%"}
                <span className="text-muted-foreground"> → </span>
                <span className={projectedNetSupplyApy >= 0 ? "text-emerald-500" : "text-red-500"}>
                  {formatPct(projectedNetSupplyApy)}
                </span>
              </>
            }
          >
            <Row label="Entry Cost" tip="One-time swap fees + price impact to enter the loop" value={`${entryCostPct.toFixed(3)}%`} />
            <Row
              label="Break-Even"
              tip="Days of carry needed to recoup the one-time entry cost"
              value={breakEvenDays > 0 ? `${breakEvenDays} days` : "—"}
              valueClass={breakEvenDays > 0 && breakEvenDays <= 30 ? "text-emerald-500" : breakEvenDays > 90 ? "text-amber-500" : ""}
            />
            <Row label="Borrow Rate" tip="Annual stability fee on USDST debt" value={formatPct(assetStabilityAPR)} />
            <Row label="Base Yield" tip="Underlying collateral yield before leveraging" value={formatPct(selectedOpportunity?.baseYieldAPR ?? 0)} />
          </ExpandableRow>
          <Row
            label="Leverage Change"
            tip="How much your collateral exposure is multiplied"
            value={<>{hasPosition ? `${currentLeverage.toFixed(1)}x` : "1.0x"} <span className="text-muted-foreground">→</span> {leverage.toFixed(1)}x</>}
          />
          <ExpandableRow
            label="Exposure"
            tip="Total collateral value after looping, including borrowed and re-deposited amounts"
            open={exposureOpen}
            onOpenChange={setExposureOpen}
            summary={<>{formatCompact(finalCollateralTokens)} {assetSymbol || "Asset"}{finalCollateralUsd > 0 && <span className="text-muted-foreground">(${formatCompact(finalCollateralUsd)})</span>}</>}
          >
            <Row
              label="Exposure"
              value={<>{formatCompact(currentCollateralTokens)} <span className="text-muted-foreground">→</span> {formatCompact(finalCollateralTokens)} {assetSymbol || "Asset"}</>}
            />
            <Row
              label="Debt"
              tip="USDST owed against your collateral"
              value={<>{formatCompact(currentDebtUsd)} <span className="text-muted-foreground">→</span> {formatCompact(finalDebtUsd)} {borrowSymbol}</>}
            />
          </ExpandableRow>
          <ExpandableRow
            label="Liquidation Price"
            tip="Asset price at which your position would be eligible for liquidation"
            open={liquidationOpen}
            onOpenChange={setLiquidationOpen}
            summary={<>{selectedAssetPrice > 0 ? `$${selectedAssetPrice.toFixed(2)}` : "0.00"} <span className="text-muted-foreground">→</span> ${projectedLiquidationPrice.toFixed(2)} ({projectedLiquidationMovePct.toFixed(2)}%)</>}
          >
            <Row
              label="Loan To Value Ratio"
              tip="Ratio of debt to collateral value"
              value={<>{hasPosition ? formatPct((currentPosition?.effectiveLTV ?? 0) * 100) : "—"} <span className="text-muted-foreground">→</span> {formatPct(finalLtv * 100)}</>}
              valueClass="text-emerald-500"
            />
            <Row label="Liquidation LTV" tip="LTV threshold that triggers liquidation" value={formatPct(liquidationLtvRatio * 100)} valueClass="text-amber-500" />
            <Row
              label="Health Factor"
              tip="How far your position is from liquidation. Below 1.0 = eligible for liquidation."
              value={<>{hasPosition ? (currentPosition?.healthFactor ?? 0).toFixed(2) : "—"} <span className="text-muted-foreground">→</span> {projectedHealthFactor > 0 ? projectedHealthFactor.toFixed(2) : "—"}</>}
              valueClass={healthFactorColor(projectedHealthFactor)}
            />
          </ExpandableRow>
        </div>

        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center">Est. fee<InfoTip text="Network transaction fee for the approve + leverage call" /></span>
            <span className="font-medium tabular-nums text-foreground">{LOOP_FEE} USDST</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default LoopWidget;
