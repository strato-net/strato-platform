import { useCallback, useEffect, useMemo, useState } from "react";
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
  LoopHistoryItem,
  LoopRouteType,
  LoopStepPreview,
  LoopUnwindMode,
} from "@/interface/loop";

const LOOP_ASSETS = ["wstETH", "rETH", "sUSDS", "syrupUSDC"];

const asNumber = (value: number | string | undefined): number => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPercent = (value: number | string | undefined): string =>
  `${asNumber(value).toFixed(2)}%`;

const formatUsd = (value: number | string | undefined): string =>
  `$${asNumber(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

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
  if (value.includes("complete") || value.includes("success")) {
    return "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300";
  }
  if (value.includes("pending") || value.includes("running")) {
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
  }
  if (value.includes("fail") || value.includes("abort")) {
    return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  }
  return "bg-muted text-muted-foreground";
};

const defaultSteps = (routeType: LoopRouteType): LoopStepPreview[] =>
  routeType === "cdp"
    ? [
        { key: "deposit", label: "Deposit collateral", description: "Lock asset into CDP vault" },
        { key: "mint", label: "Mint debt token", description: "Mint USDST against collateral" },
        { key: "swap", label: "Swap and re-enter", description: "Swap USDST back into collateral and repeat" },
      ]
    : [
        { key: "supply", label: "Supply collateral", description: "Deposit into lending market" },
        { key: "borrow", label: "Borrow debt token", description: "Borrow USDST from lending pool" },
        { key: "swap", label: "Swap and re-supply", description: "Swap USDST into collateral and repeat" },
      ];

const Loop = () => {
  const { isLoggedIn } = useUser();

  const [routeType, setRouteType] = useState<LoopRouteType>("cdp");
  const [asset, setAsset] = useState("wstETH");
  const [collateralAmount, setCollateralAmount] = useState("1");
  const [leverage, setLeverage] = useState(2);
  const [iterations, setIterations] = useState(2);
  const [unwindMode, setUnwindMode] = useState<LoopUnwindMode>("partial");
  const [unwindPercent, setUnwindPercent] = useState(50);

  const [preview, setPreview] = useState<LoopBootstrapResponse | null>(null);
  const [position, setPosition] = useState<LoopBootstrapResponse | null>(null);
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

  const loadPositionAndHistory = useCallback(async () => {
    if (!isLoggedIn) return;
    setSidePanelLoading(true);
    try {
      const [positionResponse, historyResponse] = await Promise.all([
        loopService.position(routeType, asset),
        loopService.history(routeType, asset),
      ]);
      setPosition(positionResponse);
      setHistory(historyResponse);
    } finally {
      setSidePanelLoading(false);
    }
  }, [asset, isLoggedIn, routeType]);

  const handlePreview = async () => {
    if (!isLoggedIn) return;
    setPreviewLoading(true);
    try {
      const response = await loopService.bootstrap({
        routeType,
        asset,
        collateralAmount,
        leverage,
        iterations,
      });
      setPreview(response);
      setLastActionStatus("Preview ready");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!isLoggedIn) return;
    setExecuteLoading(true);
    try {
      const response = await loopService.execute({
        routeType,
        asset,
        collateralAmount,
        leverage,
        iterations,
      });
      setLastActionStatus(response.status || response.message || "Execution submitted");
      await loadPositionAndHistory();
    } finally {
      setExecuteLoading(false);
    }
  };

  const handleUnwind = async () => {
    if (!isLoggedIn) return;
    setUnwindLoading(true);
    try {
      const response = await loopService.unwind({
        routeType,
        asset,
        mode: unwindMode,
        unwindPercent: unwindMode === "partial" ? unwindPercent : undefined,
      });
      setLastActionStatus(response.status || response.message || "Unwind submitted");
      await loadPositionAndHistory();
    } finally {
      setUnwindLoading(false);
    }
  };

  const effectiveSummary = preview || position || null;
  const healthFactor = asNumber(effectiveSummary?.healthFactor);
  const riskLevel = getRiskLevel(healthFactor);
  const stepPreview = useMemo(
    () => (preview?.steps && preview.steps.length > 0 ? preview.steps : defaultSteps(routeType)),
    [preview?.steps, routeType]
  );

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
                    {routeType === "cdp" ? "CDP loop" : "Lending loop"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={routeType === "cdp" ? "default" : "outline"}
                    onClick={() => setRouteType("cdp")}
                    className="min-w-[120px]"
                  >
                    CDP route
                  </Button>
                  <Button
                    type="button"
                    variant={routeType === "lending" ? "default" : "outline"}
                    onClick={() => setRouteType("lending")}
                    className="min-w-[120px]"
                  >
                    Lending route
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loop-asset">Asset</Label>
                    <Select value={asset} onValueChange={setAsset}>
                      <SelectTrigger id="loop-asset">
                        <SelectValue placeholder="Select asset" />
                      </SelectTrigger>
                      <SelectContent>
                        {LOOP_ASSETS.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
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
                    <p className="text-sm font-medium">Step preview</p>
                    <p className="text-xs text-muted-foreground">
                      {effectiveSummary?.totalTxCount ?? stepPreview.length} steps
                    </p>
                  </div>
                  <div className="space-y-2">
                    {stepPreview.map((step, index) => (
                      <div
                        key={step.key || `${step.label}-${index}`}
                        className="flex items-start justify-between gap-4 rounded-md border bg-background p-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-medium">{step.label}</p>
                            {step.description && (
                              <p className="text-xs text-muted-foreground">{step.description}</p>
                            )}
                          </div>
                        </div>
                        {step.txCount ? (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {step.txCount} tx
                          </span>
                        ) : null}
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
                      {effectiveSummary ? formatPercent(effectiveSummary.adjustedCarryApr) : "—"}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Leverage</p>
                    <p className="text-lg font-semibold">
                      {effectiveSummary?.leverage ? `${asNumber(effectiveSummary.leverage).toFixed(2)}x` : "—"}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Collateral</p>
                    <p className="text-lg font-semibold">
                      {effectiveSummary ? formatUsd(effectiveSummary.collateralValueUsd) : "—"}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Debt</p>
                    <p className="text-lg font-semibold">
                      {effectiveSummary ? formatUsd(effectiveSummary.debtValueUsd) : "—"}
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
                    <span>{effectiveSummary?.totalTxCount ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Estimated fee</span>
                    <span>
                      {effectiveSummary?.estimatedTxCostUsdst
                        ? `${asNumber(effectiveSummary.estimatedTxCostUsdst).toFixed(2)} USDST`
                        : "—"}
                    </span>
                  </div>
                </div>

                {preview?.warnings && preview.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-300/60 bg-amber-50/70 dark:bg-amber-500/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                      <ShieldAlert size={16} />
                      <span>Risk warnings</span>
                    </div>
                    <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                      {preview.warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`}>- {warning}</li>
                      ))}
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
                      const rowKey = item.id || `${item.timestamp || "t"}-${index}`;
                      const expanded = expandedHistoryKey === rowKey;
                      return (
                        <TableRow key={rowKey}>
                          <TableCell>{formatTimestamp(item.timestamp)}</TableCell>
                          <TableCell>{item.action || "Execute"}</TableCell>
                          <TableCell>
                            <Badge className={getStatusBadgeClass(item.status)}>{item.status || "Unknown"}</Badge>
                          </TableCell>
                          <TableCell>
                            {item.leverage !== undefined ? `${asNumber(item.leverage).toFixed(2)}x` : "—"}
                          </TableCell>
                          <TableCell>{item.iterations ?? "—"}</TableCell>
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
                            {expanded && item.summary ? (
                              <p className="mt-2 text-xs text-muted-foreground text-left">{item.summary}</p>
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
