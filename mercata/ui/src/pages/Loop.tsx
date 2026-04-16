import { useMemo, useState } from "react";
import { formatUnits } from "ethers";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { loopService } from "@/services/loopService";
import type { LoopBootstrapResponse, LoopPositionResponse } from "@/interface/loop";
import { formatBalance, parseUnitsWithTruncation } from "@/utils/numberUtils";
import { handleAmountInputChange } from "@/utils/transferValidation";

const ROUTE_TYPE = "cdp_loop" as const;

const asNumber = (value: number | string | undefined): number => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPercent = (value: number | string | undefined): string => `${asNumber(value).toFixed(2)}%`;
const formatCompactNumber = (value: number): string =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2, notation: "compact" })
    : "0";

const formatUsdFromWei = (value: string | undefined): string => {
  if (!value) return "—";
  try {
    return `$${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  } catch {
    return "—";
  }
};


type LoopMarketOption = {
  key: string;
  symbol: string;
  asset: string;
  netCarryWithImpactAPR: number;
  exposureMultiple: number;
  healthFactor: number;
};

interface LoopProps {
  embedded?: boolean;
}

const EMBEDDED_LOOP_STATE_KEY = "borrow_loop_widget_state_v1";

interface EmbeddedLoopState {
  selectedMarketKey: string;
  collateralAmount: string;
  leverage: number;
}

const DEFAULT_EMBEDDED_LOOP_STATE: EmbeddedLoopState = {
  selectedMarketKey: "",
  collateralAmount: "1",
  leverage: 2.0,
};

const readEmbeddedLoopState = (): EmbeddedLoopState => {
  if (typeof window === "undefined") return DEFAULT_EMBEDDED_LOOP_STATE;
  const rawState = window.sessionStorage.getItem(EMBEDDED_LOOP_STATE_KEY);
  if (!rawState) return DEFAULT_EMBEDDED_LOOP_STATE;
  try {
    const parsed = JSON.parse(rawState) as Partial<EmbeddedLoopState>;
    return {
      selectedMarketKey: typeof parsed.selectedMarketKey === "string" ? parsed.selectedMarketKey : "",
      collateralAmount: typeof parsed.collateralAmount === "string" ? parsed.collateralAmount : "1",
      leverage: typeof parsed.leverage === "number" && Number.isFinite(parsed.leverage) ? parsed.leverage : 2.0,
    };
  } catch {
    return DEFAULT_EMBEDDED_LOOP_STATE;
  }
};

const Loop = ({ embedded = false }: LoopProps) => {
  const { isLoggedIn } = useUser();
  const { activeTokens, fetchTokens } = useUserTokens();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { asset: assetParam } = useParams();

  const [standaloneCollateralAmount, setStandaloneCollateralAmount] = useState("1");
  const [standaloneLeverage, setStandaloneLeverage] = useState(2.0);
  const [amountError, setAmountError] = useState("");
  const [embeddedState, setEmbeddedState] = useState<EmbeddedLoopState>(readEmbeddedLoopState);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [slippageBps, setSlippageBps] = useState(100);
  const [exposureOpen, setExposureOpen] = useState(false);
  const [liquidationOpen, setLiquidationOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "position">("overview");

  const normalizedAssetParam = assetParam?.toLowerCase();
  const isDetailRoute = Boolean(normalizedAssetParam);

  if (typeof document !== "undefined" && document.title !== "Loop | STRATO") {
    document.title = "Loop | STRATO";
  }

  const persistEmbeddedState = (nextState: EmbeddedLoopState) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(EMBEDDED_LOOP_STATE_KEY, JSON.stringify(nextState));
    }
  };

  const updateEmbeddedState = (updater: (state: EmbeddedLoopState) => EmbeddedLoopState) => {
    setEmbeddedState((previousState) => {
      const nextState = updater(previousState);
      persistEmbeddedState(nextState);
      return nextState;
    });
  };

  const {
    data: preview,
    isLoading: previewLoading,
    refetch: refetchPreview,
  } = useQuery<LoopBootstrapResponse>({
    queryKey: ["loop-bootstrap"],
    queryFn: loopService.bootstrap,
    enabled: isLoggedIn,
    staleTime: 60_000,
  });

  const marketOptions = useMemo<LoopMarketOption[]>(() => {
    if (!preview?.opportunities) return [];
    const rows: LoopMarketOption[] = [];
    preview.opportunities.forEach((item) => {
      if (BigInt(item.swapPoolUSDSTLiquidity || "0") <= 0n) return;
      if (item.cdpCarry && item.cdpCarry.netCarryWithImpactAPR > 0) {
        rows.push({
          key: `cdp_loop:${item.asset.toLowerCase()}`,
          symbol: item.symbol,
          asset: item.asset,
          netCarryWithImpactAPR: item.cdpCarry.netCarryWithImpactAPR,
          exposureMultiple: item.cdpCarry.exposureMultiple,
          healthFactor: item.cdpCarry.healthFactor,
        });
      }
    });
    return rows.sort((a, b) => b.netCarryWithImpactAPR - a.netCarryWithImpactAPR);
  }, [preview?.opportunities]);

  const detailMarketKeyFromUrl = useMemo(() => {
    if (!isDetailRoute || !normalizedAssetParam) return "";
    return `cdp_loop:${normalizedAssetParam}`;
  }, [isDetailRoute, normalizedAssetParam]);

  const selectedMarketKey = embedded ? embeddedState.selectedMarketKey : detailMarketKeyFromUrl;
  const selectedMarket = useMemo(
    () => marketOptions.find((option) => option.key === selectedMarketKey) || null,
    [marketOptions, selectedMarketKey]
  );
  const selectedAssetAddress = selectedMarket?.asset;
  const assetSymbol = selectedMarket?.symbol || "";
  const showDetail = Boolean(selectedMarket);

  const {
    data: positionData,
    isLoading: positionLoading,
    refetch: refetchPosition,
  } = useQuery<LoopPositionResponse>({
    queryKey: ["loop-position"],
    queryFn: loopService.position,
    enabled: isLoggedIn && showDetail,
    staleTime: 30_000,
  });

  const filteredPosition = useMemo(() => {
    if (!positionData || !selectedAssetAddress) return null;
    const addr = selectedAssetAddress.toLowerCase();
    const match = positionData.cdp.find((p) => p.asset.toLowerCase() === addr);
    if (!match || match.leverage <= 1.01) return null;
    return match;
  }, [positionData, selectedAssetAddress]);

  const selectedOpportunity = useMemo(() => {
    if (!preview?.opportunities || !selectedAssetAddress) return null;
    return (
      preview.opportunities.find(
        (item) => item.asset.toLowerCase() === selectedAssetAddress.toLowerCase() && Boolean(item.cdpCarry)
      ) || null
    );
  }, [preview?.opportunities, selectedAssetAddress]);

  const selectedCarry = selectedOpportunity?.cdpCarry;
  const collateralAmount = embedded ? embeddedState.collateralAmount : standaloneCollateralAmount;
  const leverage = embedded ? embeddedState.leverage : standaloneLeverage;

  const selectedAssetDecimals = useMemo(() => {
    if (!preview || !selectedAssetAddress) return 18;
    return preview.routes.cdp.assets.find(
      (item) => item.address.toLowerCase() === selectedAssetAddress.toLowerCase()
    )?.decimals || 18;
  }, [preview, selectedAssetAddress]);

  const selectedTokenBalanceWei = useMemo(() => {
    if (!selectedAssetAddress) return "0";
    const token = activeTokens.find((item) => item.address.toLowerCase() === selectedAssetAddress.toLowerCase());
    if (!token) return "0";
    if (token.balance) return token.balance;
    return token.balances?.[0]?.balance || "0";
  }, [activeTokens, selectedAssetAddress]);

  const formattedWalletBalance = useMemo(
    () => formatBalance(selectedTokenBalanceWei, assetSymbol || undefined, selectedAssetDecimals, 2, 6),
    [assetSymbol, selectedAssetDecimals, selectedTokenBalanceWei]
  );

  const computedAmountError = useMemo(() => {
    if (!collateralAmount) return "";
    if (amountError) return amountError;
    try {
      const maxWei = BigInt(selectedTokenBalanceWei || "0");
      const { weiAmount } = parseUnitsWithTruncation(collateralAmount, selectedAssetDecimals);
      if (weiAmount <= 0n) return "Amount must be greater than 0";
      if (maxWei <= 0n || weiAmount > maxWei) return "Maximum amount exceeded";
      return "";
    } catch {
      return "Invalid input format";
    }
  }, [amountError, collateralAmount, selectedAssetDecimals, selectedTokenBalanceWei]);

  const hasValidAmount = Boolean(collateralAmount) && !computedAmountError;

  const handleCollateralAmountChange = (value: string) => {
    handleAmountInputChange(value, setCollateralAmount, setAmountError, selectedTokenBalanceWei, selectedAssetDecimals);
  };

  const setAmountFromBalanceRatio = (numerator: number, denominator: number) => {
    try {
      const maxWei = BigInt(selectedTokenBalanceWei || "0");
      if (maxWei <= 0n) return;
      const targetWei = (maxWei * BigInt(numerator)) / BigInt(denominator);
      handleCollateralAmountChange(formatUnits(targetWei, selectedAssetDecimals));
    } catch {}
  };

  const handleExecute = async () => {
    if (!isLoggedIn) return;
    setExecuteLoading(true);
    try {
      const bootstrapData = preview || (await refetchPreview()).data;
      if (!bootstrapData || !selectedAssetAddress || !hasValidAmount) return;
      const assetDecimals =
        bootstrapData.routes.cdp.assets.find(
          (item) => item.address.toLowerCase() === selectedAssetAddress.toLowerCase()
        )?.decimals || 18;
      const amountWei = parseUnitsWithTruncation(collateralAmount, assetDecimals).toString();
      await loopService.execute({
        routeType: ROUTE_TYPE,
        asset: selectedAssetAddress,
        amount: amountWei,
        targetLeverage: leverage,
        maxSlippageBps: slippageBps,
      });
      toast({ title: "Loop executed", variant: "success" });
      await Promise.all([refetchPreview(), refetchPosition(), fetchTokens()]);
    } catch (err: any) {
      toast({ title: "Loop failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setExecuteLoading(false);
    }
  };

  const liquidityText = useMemo(() => {
    if (!selectedOpportunity?.swapPoolUSDSTLiquidity) return "—";
    try {
      return formatUsdFromWei(selectedOpportunity.swapPoolUSDSTLiquidity);
    } catch {
      const parsed = asNumber(selectedOpportunity.swapPoolUSDSTLiquidity);
      return parsed ? `$${parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—";
    }
  }, [selectedOpportunity?.swapPoolUSDSTLiquidity]);

  const leverageSliderMax = useMemo(() => {
    if (!preview) return 5;
    const minCR = asNumber(preview.routes.cdp.minCR);
    if (minCR > 100) return Math.round((1 / (1 - 100 / minCR)) * 10) / 10;
    return 5;
  }, [preview]);

  const maxLeverageDisplay = `${leverageSliderMax.toFixed(1)}x`;
  const borrowSymbol = "USDST";

  const collateralAmountNumber = useMemo(() => {
    const parsed = Number.parseFloat(collateralAmount || "0");
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }, [collateralAmount]);

  const selectedAssetPrice = useMemo(() => {
    if (!preview || !selectedAssetAddress) return 0;
    const cdpAsset = preview.routes.cdp.assets.find(
      (a) => a.address.toLowerCase() === selectedAssetAddress.toLowerCase()
    );
    if (cdpAsset?.price) {
      try { return Number(formatUnits(cdpAsset.price, 18)); } catch {}
    }
    return 0;
  }, [preview, selectedAssetAddress]);

  const effectiveLtvRatio = useMemo(() => {
    if (leverage <= 1) return 0;
    return (leverage - 1) / leverage;
  }, [leverage]);

  const projectedNetSupplyApy = useMemo(() => {
    if (!preview || !selectedOpportunity || leverage <= 1) return 0;
    const baseYield = selectedOpportunity.baseYieldAPR;
    const swapFeeBps = preview.swapFeeBps;
    const borrowRate = preview.routes.cdp.stabilityAPR;
    const q = effectiveLtvRatio;
    const M = q < 1 ? 1 / (1 - q) : leverage;
    const gross = M * baseYield - (M - 1) * borrowRate;
    const feeDrag = 2 * (M - 1) * (swapFeeBps / 10000) * 100;
    const net = gross - feeDrag;
    const poolReserve = Number(formatUnits(selectedOpportunity.swapPoolUSDSTLiquidity || "0", 18));
    const refUSD = collateralAmountNumber * selectedAssetPrice || 1000;
    const avgLeg = (M - 1) * refUSD / Math.max(Math.ceil(M - 1), 1);
    const g = 1 - swapFeeBps / 10000;
    const impact = poolReserve > 0 && avgLeg > 0 ? (g * avgLeg) / (poolReserve + g * avgLeg) : 0;
    const impactDrag = 2 * (M - 1) * impact * 100;
    return Math.round((net - impactDrag) * 1000) / 1000;
  }, [preview, selectedOpportunity, leverage, effectiveLtvRatio, collateralAmountNumber, selectedAssetPrice]);

  const projectedExposure = useMemo(() => collateralAmountNumber * leverage, [collateralAmountNumber, leverage]);
  const projectedExposureUsd = useMemo(() => projectedExposure * selectedAssetPrice, [projectedExposure, selectedAssetPrice]);
  const projectedDebt = useMemo(() => Math.max(0, projectedExposure - collateralAmountNumber), [collateralAmountNumber, projectedExposure]);

  const ltvFromCR = (rawRatio: number): number => {
    if (rawRatio <= 0) return 0;
    return rawRatio > 1 ? 1 / (rawRatio / 100) : rawRatio;
  };

  const maxLtvRatio = useMemo(
    () => (preview ? ltvFromCR(asNumber(preview.routes.cdp.minCR)) : 0),
    [preview]
  );

  const liquidationLtvRatio = useMemo(
    () => (preview ? ltvFromCR(asNumber(preview.routes.cdp.liquidationRatio)) : 0),
    [preview]
  );

  const projectedLiquidationPrice = useMemo(() => {
    if (liquidationLtvRatio <= 0 || selectedAssetPrice <= 0 || effectiveLtvRatio <= 0) return 0;
    return selectedAssetPrice * effectiveLtvRatio / liquidationLtvRatio;
  }, [effectiveLtvRatio, liquidationLtvRatio, selectedAssetPrice]);

  const projectedLiquidationMovePct = useMemo(() => {
    if (selectedAssetPrice <= 0) return 0;
    return ((projectedLiquidationPrice - selectedAssetPrice) / selectedAssetPrice) * 100;
  }, [projectedLiquidationPrice, selectedAssetPrice]);

  function setCollateralAmount(value: string) {
    if (!embedded) {
      setStandaloneCollateralAmount(value);
      return;
    }
    updateEmbeddedState((state) => ({ ...state, collateralAmount: value }));
  }

  function setLeverage(value: number) {
    if (!embedded) {
      setStandaloneLeverage(value);
      return;
    }
    updateEmbeddedState((state) => ({ ...state, leverage: value }));
  }

  const loopContent = (
    <>
      {!isLoggedIn && (
        <GuestSignInBanner message="Sign in to leverage your CDP position." />
      )}

      {!embedded && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Multiply</span>
                <span>&gt;</span>
                <span>{assetSymbol || "Select Asset"} (CDP Market)</span>
              </div>
              <div className="flex items-center gap-4">
                <span>Oracle price: $1.00</span>
                <span className="text-green-600 dark:text-green-400">{formatPercent(selectedCarry?.netCarryWithImpactAPR)}</span>
                <span>Soft liquidations from 0.10%</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9"
                  onClick={() => navigate("/dashboard/loop")}
                  disabled={!showDetail}
                >
                  <ArrowLeft size={16} />
                </Button>
                <div className="flex items-center gap-2">
                  <h1 className="text-3xl font-semibold tracking-tight">{assetSymbol || "Asset"}/{borrowSymbol} Multiply</h1>
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">CDP</Badge>
                </div>
              </div>
            </div>

          </div>
      )}

          {showDetail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  if (embedded) {
                    updateEmbeddedState((state) => ({ ...state, selectedMarketKey: "" }));
                    setAmountError("");
                    return;
                  }
                  setAmountError("");
                  navigate("/dashboard/loop");
                }}
              >
                <ArrowLeft size={14} />
              </Button>
              <h2 className="text-xl font-semibold">
                {assetSymbol || "Asset"} CDP Loop
              </h2>
            </div>
            <div className="flex gap-6 border-b border-border text-sm">
              {(["overview", "position"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={`pb-2 transition-colors ${
                    detailTab === tab
                      ? "font-medium text-foreground border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "overview" ? "Overview" : "Your Position"}
                </button>
              ))}
            </div>
          </div>
          )}

          {!showDetail && (
          <Card className="border-border bg-card/80">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Loop markets</p>
                  <p className="text-xs text-muted-foreground">
                    {embedded ? "Pick a market to configure the trade panel" : "Pick a market to open its loop page"}
                  </p>
                </div>
                {previewLoading && marketOptions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Loading loop markets...</div>
                ) : marketOptions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No loop markets available.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {marketOptions.map((option) => {
                      const active = selectedMarketKey === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            if (embedded) {
                              updateEmbeddedState((state) => ({
                                ...state,
                                selectedMarketKey: option.key,
                              }));
                              setAmountError("");
                              return;
                            }
                            setAmountError("");
                            navigate(`/dashboard/loop/cdp_loop/${option.asset}`);
                          }}
                          className={`rounded-md border p-3 text-left transition-all duration-200 ${
                            active
                              ? "border-primary bg-primary/10 shadow-sm"
                              : "border-border hover:border-primary/40 hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium">{option.symbol}</div>
                            <Badge variant="outline">CDP</Badge>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>
                              <p>APY</p>
                              <p className="text-foreground">{formatPercent(option.netCarryWithImpactAPR)}</p>
                            </div>
                            <div>
                              <p>Max Lev</p>
                              <p className="text-foreground">{asNumber(option.exposureMultiple).toFixed(1)}x</p>
                            </div>
                            <div>
                              <p>Health</p>
                              <p className="text-foreground">{asNumber(option.healthFactor).toFixed(2)}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          )}

          {showDetail && (
          <div className="grid grid-cols-1 xl:grid-cols-[0.7fr_1.3fr] gap-6">
            <Card className="border-border bg-card/80 h-fit xl:order-1">
              <CardContent className="space-y-5 pt-6">
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-base font-medium text-foreground">{assetSymbol || "—"}</span>
                      <Input id="loop-size" value={collateralAmount} onChange={(event) => handleCollateralAmountChange(event.target.value)} placeholder="0.00" disabled={!isLoggedIn} className="h-8 border-0 bg-transparent px-0 pl-16 text-right text-3xl font-semibold shadow-none focus-visible:ring-0" />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Balance: {formattedWalletBalance}</span>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setAmountFromBalanceRatio(1, 2)} disabled={!isLoggedIn}>Half</Button>
                        <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setAmountFromBalanceRatio(1, 1)} disabled={!isLoggedIn}>Max</Button>
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
                  <Slider id="loop-leverage" min={1.1} max={leverageSliderMax} step={0.1} value={[leverage]} onValueChange={(value) => setLeverage(value[0] ?? leverage)} disabled={!isLoggedIn} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>1.1x</span>
                    <span className="inline-block w-12 text-right tabular-nums">{leverageSliderMax.toFixed(1)}x</span>
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  onClick={handleExecute}
                  disabled={!isLoggedIn || executeLoading || !selectedAssetAddress || !hasValidAmount}
                >
                  {executeLoading ? "Processing..." : "Execute"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">Actual leverage may vary within ~0.1% of target</p>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Slippage Tolerance</span>
                    <div className="flex items-center gap-1">
                      {[50, 100, 200].map((bps) => (
                        <button key={bps} type="button" onClick={() => setSlippageBps(bps)} className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${slippageBps === bps ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{(bps / 100).toFixed(1)}%</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Swap Fee</span><span className="font-medium tabular-nums">{((preview?.swapFeeBps || 0) / 100).toFixed(2)}%</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Net Supply APY</span><span className="font-medium tabular-nums">0.00% <span className="text-muted-foreground">→</span> <span className="text-emerald-500">{formatPercent(projectedNetSupplyApy)}</span></span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Leverage Change</span><span className="font-medium tabular-nums">1.0x <span className="text-muted-foreground">→</span> {leverage.toFixed(1)}x</span></div>
                  <Collapsible open={exposureOpen} onOpenChange={setExposureOpen}>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Exposure</span><CollapsibleTrigger asChild><button type="button" className="flex items-center gap-1 font-medium tabular-nums">{formatCompactNumber(projectedExposure)} {assetSymbol || "Asset"}{projectedExposureUsd > 0 && <span className="text-muted-foreground">(${formatCompactNumber(projectedExposureUsd)})</span>}{exposureOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></CollapsibleTrigger></div>
                    <CollapsibleContent><div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-sm"><div className="flex items-center justify-between"><span className="text-muted-foreground">New Exposure</span><span className="font-medium tabular-nums">0.00 <span className="text-muted-foreground">→</span> {formatCompactNumber(projectedExposure)} {assetSymbol || "Asset"}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-muted-foreground">New Debt</span><span className="font-medium tabular-nums">0.00 <span className="text-muted-foreground">→</span> {formatCompactNumber(projectedDebt)} {borrowSymbol}</span></div></div></CollapsibleContent>
                  </Collapsible>
                  <Collapsible open={liquidationOpen} onOpenChange={setLiquidationOpen}>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Liquidation Price</span><CollapsibleTrigger asChild><button type="button" className="flex items-center gap-1 font-medium tabular-nums">{selectedAssetPrice > 0 ? `$${selectedAssetPrice.toFixed(2)}` : "0.00"} <span className="text-muted-foreground">→</span> ${projectedLiquidationPrice.toFixed(2)} ({projectedLiquidationMovePct.toFixed(2)}%){liquidationOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></CollapsibleTrigger></div>
                    <CollapsibleContent><div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-sm"><div className="flex items-center justify-between"><span className="text-muted-foreground">Loan To Value Ratio</span><span className="font-medium tabular-nums text-emerald-500">→ {formatPercent(effectiveLtvRatio * 100)}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-muted-foreground">Liquidation LTV</span><span className="font-medium tabular-nums text-amber-500">{formatPercent(liquidationLtvRatio * 100)}</span></div></div></CollapsibleContent>
                  </Collapsible>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Est. fee</span>
                    <span className="font-medium tabular-nums text-foreground">0.02 USDST</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="xl:order-2">
              {detailTab === "overview" && (
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
                    <p className="text-2xl font-bold tabular-nums text-emerald-500">{formatPercent(selectedCarry?.netCarryWithImpactAPR)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Collateral Asset</span><span className="font-medium">{assetSymbol}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Max LTV</span><span className="font-medium tabular-nums">{formatPercent(maxLtvRatio * 100)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Debt Asset</span><span className="font-medium">{borrowSymbol}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Liquidation LTV</span><span className="font-medium tabular-nums">{formatPercent(liquidationLtvRatio * 100)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-muted-foreground">Average Leverage Taken</span><span className="font-medium tabular-nums">{maxLeverageDisplay}</span></div>
                </div>
              </div>
              )}

              {detailTab === "position" && (
              <div className="space-y-6">
                {!isLoggedIn ? (
                  <p className="text-sm text-muted-foreground">Sign in to view your position.</p>
                ) : positionLoading ? (
                  <p className="text-sm text-muted-foreground">Loading position data...</p>
                ) : !filteredPosition ? (
                  <div className="rounded-lg border border-border bg-card p-8 text-center">
                    <p className="text-muted-foreground">No active position for {assetSymbol} on this route.</p>
                  </div>
                ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border bg-card p-4">
                      <p className="text-xs text-muted-foreground mb-2">Leverage</p>
                      <p className="text-2xl font-bold tabular-nums">{filteredPosition.leverage.toFixed(2)}x</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                      <p className="text-xs text-muted-foreground mb-2">Net APY</p>
                      <p className={`text-2xl font-bold tabular-nums ${filteredPosition.estimatedCarryAPR >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatPercent(filteredPosition.estimatedCarryAPR)}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-4">
                      <p className="text-xs text-muted-foreground mb-2">Health Factor</p>
                      <p className={`text-2xl font-bold tabular-nums ${filteredPosition.healthFactor < 1.5 ? "text-amber-500" : "text-emerald-500"}`}>{filteredPosition.healthFactor.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">{assetSymbol} Supplied</span><span className="font-medium tabular-nums">{formatBalance(filteredPosition.collateral, undefined, selectedAssetDecimals, 4, 4)} <span className="text-muted-foreground">({formatUsdFromWei(filteredPosition.collateralUSD)})</span></span></div>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">{borrowSymbol} Borrowed</span><span className="font-medium tabular-nums">{formatBalance(filteredPosition.debt, undefined, 18, 4, 4)} <span className="text-muted-foreground">({formatUsdFromWei(filteredPosition.debt)})</span></span></div>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Position LTV</span><span className="font-medium tabular-nums text-emerald-500">{formatPercent(filteredPosition.effectiveLTV * 100)}</span></div>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Liquidation LTV</span><span className="font-medium tabular-nums text-amber-500">{formatPercent(liquidationLtvRatio * 100)}</span></div>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Max Leverage</span><span className="font-medium tabular-nums">{maxLeverageDisplay}</span></div>
                    <div className="flex items-center justify-between"><span className="text-muted-foreground">Max Leverage APY</span><span className="font-medium tabular-nums text-emerald-500">{formatPercent(selectedCarry?.netCarryWithImpactAPR)}</span></div>
                    {filteredPosition.collateralizationRatio !== undefined && (
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Collateralization Ratio</span><span className="font-medium tabular-nums">{formatPercent(asNumber(filteredPosition.collateralizationRatio))}</span></div>
                    )}
                  </div>
                </>
                )}
              </div>
              )}
            </div>
          </div>
          )}

    </>
  );

  if (embedded) {
    return <div className="space-y-6">{loopContent}</div>;
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Multiply" subtitle="Leverage your exposure in a single click" />
        <main className="p-4 md:p-6 space-y-6">{loopContent}</main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Loop;
