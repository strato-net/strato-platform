import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "ethers";
import { Repeat2, TrendingUp, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUser } from "@/context/UserContext";
import { loopService } from "@/services/loopService";
import type {
  LoopBootstrapResponse,
  LoopPositionEntry,
  LoopHistoryItem,
  LoopRouteType,
  LoopUnwindMode,
} from "@/interface/loop";
import { parseUnitsWithTruncation } from "@/utils/numberUtils";

const DEFAULT_ASSET_SYMBOL = "wstETH";

const asNumber = (value: number | string | undefined): number => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPercent = (value: number | string | undefined): string => `${asNumber(value).toFixed(2)}%`;

const formatUsd = (value: number | string | undefined): string => `$${asNumber(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const formatUsdFromWei = (value: string | undefined): string => {
  if (!value) return "—";
  try {
    return `$${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  } catch {
    return "—";
  }
};

const formatTimestamp = (value?: string): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const getRiskLevel = (healthFactor: number): number => {
  if (healthFactor >= 2.5) return 10;
  if (healthFactor >= 2) return 25;
  if (healthFactor >= 1.6) return 45;
  if (healthFactor >= 1.3) return 70;
  return 90;
};

const getHealthClass = (healthFactor: number): string => {
  if (healthFactor >= 2) return "text-green-600 dark:text-green-400";
  if (healthFactor >= 1.5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
};

const getStatusBadgeClass = (status?: string): string => {
  const value = (status || "").toLowerCase();
  if (value.includes("success")) {
    return "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300";
  }
  if (value.includes("partial")) {
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
  }
  if (value.includes("fail")) {
    return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  }
  return "bg-muted text-muted-foreground";
};

const Loop = () => {
  const { isLoggedIn } = useUser();

  const [routeType, setRouteType] = useState<LoopRouteType>("cdp_loop");
  const [assetSymbol, setAssetSymbol] = useState(DEFAULT_ASSET_SYMBOL);
  const [collateralAmount, setCollateralAmount] = useState("1");
  const [leverage, setLeverage] = useState(2.0);
  const [iterations, setIterations] = useState(2);
  const [unwindMode, setUnwindMode] = useState<LoopUnwindMode>("partial");
  const [unwindPercent, setUnwindPercent] = useState(50);

  const [preview, setPreview] = useState<LoopBootstrapResponse | null>(null);
  const [position, setPosition] = useState<LoopPositionEntry | null>(null);
  const [history, setHistory] = useState<LoopHistoryItem[]>([]);
  const [expandedHistoryKey, setExpandedHistoryKey] = useState<string | null>(null);
  const [lastActionStatus, setLastActionStatus] = useState<string>("");

  const [previewLoading, setPreviewLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [unwindLoading, setUnwindLoading] = useState(false);
  const [sidePanelLoading, setSidePanelLoading] = useState(false);

  useEffect(() => {
    document.title = "Loop | STRATO";
  }, []);

  const routeOpportunities = useMemo(() => {
    if (!preview?.opportunities) return [];
    return preview.opportunities.filter((item) =>
      routeType === "cdp_loop" ? Boolean(item.cdpCarry) : Boolean(item.lendingCarry)
    );
  }, [preview?.opportunities, routeType]);

  useEffect(() => {
    if (routeOpportunities.length === 0) return;
    const hasSelected = routeOpportunities.some((item) => item.symbol === assetSymbol);
    if (!hasSelected) {
      setAssetSymbol(routeOpportunities[0].symbol);
    }
  }, [assetSymbol, routeOpportunities]);

  const selectedOpportunity = useMemo(
    () => routeOpportunities.find((item) => item.symbol === assetSymbol) || null,
    [assetSymbol, routeOpportunities]
  );
  const selectedAssetAddress = selectedOpportunity?.asset;
  const selectedCarry = routeType === "cdp_loop" ? selectedOpportunity?.cdpCarry : selectedOpportunity?.lendingCarry;
  const txPerLoop = 3;
  const estimatedTxCount = iterations * txPerLoop;
  const gasFeePerStep = preview?.gasFeePerStep;
  const estimatedFeeUsdst = useMemo(() => {
    if (!gasFeePerStep) return "—";
    try {
      return `${Number(formatUnits(BigInt(gasFeePerStep) * BigInt(estimatedTxCount), 18)).toFixed(4)} USDST`;
    } catch {
      return "—";
    }
  }, [estimatedTxCount, gasFeePerStep]);

  const loadPositionAndHistory = useCallback(async () => {
    if (!isLoggedIn) return;
    setSidePanelLoading(true);
    try {
      const [positionResponse, historyResponse] = await Promise.all([
        loopService.position(),
        loopService.history(),
      ]);
      const routePositions = routeType === "cdp_loop" ? positionResponse.cdp : positionResponse.lending;
      const selectedPosition = selectedAssetAddress
        ? routePositions.find((item) => item.asset.toLowerCase() === selectedAssetAddress.toLowerCase()) || null
        : routePositions[0] || null;
      setPosition(selectedPosition);
      setHistory(
        historyResponse.filter(
          (item) =>
            item.routeType === routeType &&
            (!selectedAssetAddress || item.asset.toLowerCase() === selectedAssetAddress.toLowerCase())
        )
      );
    } finally {
      setSidePanelLoading(false);
    }
  }, [isLoggedIn, routeType, selectedAssetAddress]);

  const ensureBootstrap = useCallback(async (): Promise<LoopBootstrapResponse | null> => {
    if (preview) return preview;
    try {
      const response = await loopService.bootstrap();
      setPreview(response);
      return response;
    } catch {
      return null;
    }
  }, [preview]);

  const handlePreview = async () => {
    if (!isLoggedIn) return;
    setPreviewLoading(true);
    try {
      const response = await loopService.bootstrap();
      setPreview(response);
      setLastActionStatus("Preview ready");
      await loadPositionAndHistory();
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!isLoggedIn) return;
    setExecuteLoading(true);
    try {
      const bootstrapData = await ensureBootstrap();
      if (!bootstrapData || !selectedAssetAddress) {
        setLastActionStatus("Select a valid loopable asset first");
        return;
      }
      const routeAssets =
        routeType === "cdp_loop" ? bootstrapData.routes.cdp.assets : bootstrapData.routes.lending.assets;
      const assetDecimals =
        routeAssets.find((item) => item.address.toLowerCase() === selectedAssetAddress.toLowerCase())?.decimals || 18;
      const amountWei = parseUnitsWithTruncation(collateralAmount, assetDecimals).toString();
      const response = await loopService.execute({
        routeType,
        asset: selectedAssetAddress,
        amount: amountWei,
        loops: iterations,
        minHealthFactor: leverage >= 2.5 ? 1.3 : 1.15,
      });
      const failedStep = response.executedSteps.find((step) => step.status === "failed");
      setLastActionStatus(failedStep ? `Execution failed: ${failedStep.action}` : "Execution submitted");
      await loadPositionAndHistory();
    } finally {
      setExecuteLoading(false);
    }
  };

  const handleUnwind = async () => {
    if (!isLoggedIn) return;
    setUnwindLoading(true);
    try {
      if (!selectedAssetAddress) {
        setLastActionStatus("Select a valid loopable asset first");
        return;
      }
      const steps =
        unwindMode === "full"
          ? "all"
          : Math.max(1, Math.min(iterations, Math.round((iterations * unwindPercent) / 100)));
      const response = await loopService.unwind({
        routeType,
        asset: selectedAssetAddress,
        steps,
      });
      const failedStep = response.executedSteps.find((step) => step.status === "failed");
      setLastActionStatus(failedStep ? `Unwind failed: ${failedStep.action}` : "Unwind submitted");
      await loadPositionAndHistory();
    } finally {
      setUnwindLoading(false);
    }
  };

  const healthFactor = asNumber(position?.healthFactor || selectedCarry?.healthFactor);
  const riskLevel = getRiskLevel(healthFactor);
  const actionLabel = routeType === "cdp_loop" ? "CDP route" : "Lending route";

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Loop" subtitle="Multiply yield strategies with guided leverage controls" />

        <main className="p-4 md:p-6 space-y-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to preview, execute, and unwind loop strategies." />
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
            <Card className="border-border">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">Loop strategy builder</CardTitle>
                    <CardDescription>Kamino-style flow: configure, preview, execute</CardDescription>
                  </div>
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    {routeType === "cdp_loop" ? "CDP loop" : "Lending loop"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={routeType === "cdp_loop" ? "default" : "outline"}
                    onClick={() => setRouteType("cdp_loop")}
                    className="min-w-[120px]"
                  >
                    CDP route
                  </Button>
                  <Button
                    type="button"
                    variant={routeType === "lending_loop" ? "default" : "outline"}
                    onClick={() => setRouteType("lending_loop")}
                    className="min-w-[120px]"
                  >
                    Lending route
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loop-asset">Asset</Label>
                    <Select value={assetSymbol} onValueChange={setAssetSymbol}>
                      <SelectTrigger id="loop-asset">
                        <SelectValue placeholder="Select asset" />
                      </SelectTrigger>
                      <SelectContent>
                        {routeOpportunities.length > 0 ? routeOpportunities.map((item) => (
                          <SelectItem key={item.asset} value={item.symbol}>
                            {item.symbol}
                          </SelectItem>
                        )) : (
                          <SelectItem value={DEFAULT_ASSET_SYMBOL}>{DEFAULT_ASSET_SYMBOL}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="loop-size">Collateral amount</Label>
                    <Input
                      id="loop-size"
                      value={collateralAmount}
                      onChange={(event) => setCollateralAmount(event.target.value)}
                      placeholder="0.00"
                      disabled={!isLoggedIn}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="loop-leverage">Target leverage</Label>
                    <span className="text-sm font-medium">{leverage.toFixed(1)}x</span>
                  </div>
                  <Slider
                    id="loop-leverage"
                    min={1}
                    max={5}
                    step={0.1}
                    value={[leverage]}
                    onValueChange={(value) => setLeverage(value[0] ?? leverage)}
                    disabled={!isLoggedIn}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="loop-iterations">Iterations</Label>
                    <span className="text-sm font-medium">{iterations}</span>
                  </div>
                  <Slider
                    id="loop-iterations"
                    min={1}
                    max={5}
                    step={1}
                    value={[iterations]}
                    onValueChange={(value) => setIterations(value[0] ?? iterations)}
                    disabled={!isLoggedIn}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button type="button" onClick={handlePreview} disabled={!isLoggedIn || previewLoading}>
                    {previewLoading ? "Previewing..." : "Preview strategy"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleExecute}
                    disabled={!isLoggedIn || executeLoading}
                  >
                    {executeLoading ? "Executing..." : "Execute loop"}
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={loadPositionAndHistory}
                  disabled={!isLoggedIn || sidePanelLoading}
                >
                  {sidePanelLoading ? "Refreshing..." : "Refresh position and history"}
                </Button>

                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{actionLabel} step preview</p>
                    <p className="text-xs text-muted-foreground">
                      {estimatedTxCount} actions
                    </p>
                  </div>
                  <div className="space-y-2">
                    {[
                      routeType === "cdp_loop" ? "Deposit collateral" : "Supply collateral",
                      routeType === "cdp_loop" ? "Mint/borrow USDST" : "Borrow USDST",
                      "Swap and repeat",
                    ].map((label, index) => (
                      <div
                        key={`${label}-${index}`}
                        className="flex items-start justify-between gap-4 rounded-md border bg-background p-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-medium">{label}</p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">per loop</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm font-medium">Unwind controls</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={unwindMode === "partial" ? "default" : "outline"}
                      onClick={() => setUnwindMode("partial")}
                    >
                      Partial close
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={unwindMode === "full" ? "default" : "outline"}
                      onClick={() => setUnwindMode("full")}
                    >
                      Full close
                    </Button>
                  </div>
                  {unwindMode === "partial" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="loop-unwind">Close size</Label>
                        <span className="text-sm font-medium">{unwindPercent}%</span>
                      </div>
                      <Slider
                        id="loop-unwind"
                        min={10}
                        max={100}
                        step={5}
                        value={[unwindPercent]}
                        onValueChange={(value) => setUnwindPercent(value[0] ?? unwindPercent)}
                        disabled={!isLoggedIn}
                      />
                    </div>
                  )}
                  <Button type="button" variant="outline" onClick={handleUnwind} disabled={!isLoggedIn || unwindLoading}>
                    {unwindLoading ? "Unwinding..." : "Submit unwind"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Position and risk</CardTitle>
                  {lastActionStatus ? (
                    <Badge className={getStatusBadgeClass(lastActionStatus)}>{lastActionStatus}</Badge>
                  ) : (
                    <Badge variant="secondary">Live summary</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Adjusted carry</p>
                    <p className="text-lg font-semibold">
                      {selectedCarry ? formatPercent(selectedCarry.netCarryWithImpactAPR) : "—"}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Leverage</p>
                    <p className="text-lg font-semibold">
                      {position?.leverage !== undefined
                        ? `${asNumber(position.leverage).toFixed(2)}x`
                        : selectedCarry
                          ? `${asNumber(selectedCarry.exposureMultiple).toFixed(2)}x`
                          : "—"}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Collateral</p>
                    <p className="text-lg font-semibold">
                      {formatUsdFromWei(position?.collateralUSD)}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Debt</p>
                    <p className="text-lg font-semibold">
                      {formatUsdFromWei(position?.debt)}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Health factor</p>
                    <p className={`text-lg font-semibold ${getHealthClass(healthFactor)}`}>
                      {effectiveSummary ? healthFactor.toFixed(2) : "—"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          riskLevel >= 70
                            ? "bg-red-500"
                            : riskLevel >= 40
                              ? "bg-amber-500"
                              : "bg-green-500"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(8, riskLevel))}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Safe</span>
                      <span>Risk increases toward liquidation</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <TrendingUp size={16} />
                    <span>Execution cost</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Estimated tx count</span>
                    <span>{estimatedTxCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Estimated fee</span>
                    <span>{estimatedFeeUsdst}</span>
                  </div>
                </div>

                {selectedCarry && selectedCarry.netCarryWithImpactAPR < 0 && (
                  <div className="rounded-md border border-amber-300/60 bg-amber-50/70 dark:bg-amber-500/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                      <ShieldAlert size={16} />
                      <span>Risk warnings</span>
                    </div>
                    <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                      <li>- Adjusted carry is negative for this route/asset at current assumptions.</li>
                      <li>- Continue only if this is intentional for strategy testing.</li>
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Repeat2 size={16} />
                <CardTitle className="text-lg">Loop history</CardTitle>
              </div>
              <CardDescription>Recent executions and unwind actions for the selected route</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Leverage</TableHead>
                    <TableHead>Iterations</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sidePanelLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Loading history...
                      </TableCell>
                    </TableRow>
                  ) : history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No loop activity yet for this route.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((item, index) => {
                      const rowKey = item.requestId || `${item.timestamp || "t"}-${index}`;
                      const expanded = expandedHistoryKey === rowKey;
                      return (
                        <TableRow key={rowKey}>
                          <TableCell>{formatTimestamp(item.timestamp)}</TableCell>
                          <TableCell>{item.amount === "unwind" ? "Unwind" : "Execute"}</TableCell>
                          <TableCell>
                            <Badge className={getStatusBadgeClass(item.status)}>{item.status || "Unknown"}</Badge>
                          </TableCell>
                          <TableCell>
                            {position?.leverage !== undefined ? `${asNumber(position.leverage).toFixed(2)}x` : "—"}
                          </TableCell>
                          <TableCell>{item.loops ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setExpandedHistoryKey(expanded ? null : rowKey)}
                            >
                              {expanded ? (
                                <>
                                  Hide <ChevronUp />
                                </>
                              ) : (
                                <>
                                  Show <ChevronDown />
                                </>
                              )}
                            </Button>
                            {expanded ? (
                              <div className="mt-2 text-xs text-muted-foreground text-left space-y-1">
                                <p>Request: {item.requestId}</p>
                                <p>Asset: {item.asset}</p>
                                {item.txHashes?.length ? <p>Txs: {item.txHashes.join(", ")}</p> : null}
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Loop;
