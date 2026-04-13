import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "ethers";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import { safeParseUnits, ensureHexPrefix } from "@/utils/numberUtils";
import type { YieldVaultInfo } from "@/context/YieldVaultContext.shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import CopyButton from "@/components/ui/copy";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type YieldVaultDef = {
  key: string;
  address: string;
  name: string;
  assetSymbol: string;
  shareSymbol: string;
};

const formatTokenAmount = (value: string, decimals = 18, maxFractionDigits = 4): string => {
  try {
    const num = Number(formatUnits(value || "0", decimals));
    if (!Number.isFinite(num) || Math.abs(num) < 0.000001) return "0";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
  } catch {
    return "0";
  }
};

const formatAddress = (value: string): string => {
  const raw = (value || "").replace(/^0x/, "");
  if (!raw) return "--";
  if (raw.length <= 10) return `0x${raw}`;
  return `0x${raw.slice(0, 6)}...${raw.slice(-4)}`;
};

const isFullHexAddress = (value: string | undefined): value is `0x${string}` =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const YieldVaultAdminTab = () => {
  const { toast } = useToast();
  const [vaultDefs, setVaultDefs] = useState<YieldVaultDef[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [vaultInfo, setVaultInfo] = useState<YieldVaultInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  const [strategyAddress, setStrategyAddress] = useState("");
  const [capitalAmount, setCapitalAmount] = useState("");
  const [lossAmount, setLossAmount] = useState("");
  const [minIdleBps, setMinIdleBps] = useState("");

  const refreshVaultInfo = useCallback(async (key: string) => {
    if (!key) {
      setVaultInfo(null);
      return;
    }
    const response = await api.get<YieldVaultInfo>(`/earn/yield-vault/${key}/info`);
    setVaultInfo(response.data);
    setMinIdleBps(response.data.minIdleBps || "0");
  }, []);

  const loadVaults = useCallback(async () => {
    setLoading(true);
    try {
      const defsResponse = await api.get<YieldVaultDef[]>("/earn/yield-vault");
      const defs = defsResponse.data || [];
      setVaultDefs(defs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVaults().catch(() => setLoading(false));
  }, [loadVaults]);

  useEffect(() => {
    if (!selectedKey && vaultDefs[0]?.key) {
      setSelectedKey(vaultDefs[0].key);
      return;
    }
    if (!selectedKey) return;
    refreshVaultInfo(selectedKey).catch(() => undefined);
  }, [selectedKey, refreshVaultInfo, vaultDefs]);

  const selectedVault = useMemo(
    () => vaultDefs.find((vault) => vault.key === selectedKey) || null,
    [selectedKey, vaultDefs]
  );

  const assetDecimals = vaultInfo?.decimals ?? 18;
  const normalizedStrategy = ensureHexPrefix(strategyAddress?.trim());
  const capitalAmountWei = capitalAmount ? safeParseUnits(capitalAmount, assetDecimals) : 0n;
  const lossAmountWei = lossAmount ? safeParseUnits(lossAmount, assetDecimals) : 0n;
  const hasStrategy = isFullHexAddress(normalizedStrategy);
  const hasCapitalAmount = capitalAmountWei > 0n;
  const hasLossAmount = lossAmountWei > 0n;
  const minIdleValue = minIdleBps.trim();
  const minIdleValid =
    /^\d+$/.test(minIdleValue) && Number(minIdleValue) >= 0 && Number(minIdleValue) <= 10000;
  const selectedHolding =
    vaultInfo?.strategyHoldings?.find(
      (holding) => normalizeAddress(holding.strategyAddress) === normalizeAddress(normalizedStrategy)
    ) || null;
  const selectedStrategyDebtWei = BigInt(selectedHolding?.deployedAssets || "0");
  const remainingDebtAfterLossWei =
    lossAmountWei >= selectedStrategyDebtWei ? 0n : selectedStrategyDebtWei - lossAmountWei;
  const lossExceedsDebt = hasLossAmount && lossAmountWei > selectedStrategyDebtWei;
  const totalQueuedSharesWei = BigInt(vaultInfo?.totalQueuedShares || "0");
  const idleAssetsWei = BigInt(vaultInfo?.idleAssets || "0");
  const totalClaimableAssetsWei = BigInt(vaultInfo?.totalClaimableAssets || "0");
  const queueProcessableAssetsWei =
    idleAssetsWei > totalClaimableAssetsWei ? idleAssetsWei - totalClaimableAssetsWei : 0n;
  const hasOpenQueue = totalQueuedSharesWei > 0n;

  const runAdminAction = useCallback(
    async (
      actionKey: string,
      request: () => Promise<unknown>,
      successTitle: string,
      successDescription: string
    ) => {
      try {
        setSubmittingAction(actionKey);
        await request();
        toast({
          title: successTitle,
          description: successDescription,
          variant: "success",
        });
        setCapitalAmount("");
        setLossAmount("");
        await refreshVaultInfo(selectedKey);
      } catch (error: unknown) {
        const description = error instanceof Error ? error.message : "Transaction failed";
        toast({
          title: "Action failed",
          description,
          variant: "destructive",
        });
      } finally {
        setSubmittingAction(null);
      }
    },
    [refreshVaultInfo, selectedKey, toast]
  );

  if (loading && !vaultInfo) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Carry Vault Admin</CardTitle>
          <CardDescription>
            Owner actions for the ETH and wBTC carry vaults: strategy approval, capital deployment, capital return, and explicit loss reporting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="yield-vault-select">Vault</Label>
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger id="yield-vault-select">
                  <SelectValue placeholder="Select carry vault" />
                </SelectTrigger>
                <SelectContent>
                  {vaultDefs.map((vault) => (
                    <SelectItem key={vault.key} value={vault.key}>
                      {vault.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="yield-vault-strategy">Strategy Address</Label>
              <Input
                id="yield-vault-strategy"
                placeholder="0x..."
                value={strategyAddress}
                onChange={(event) => setStrategyAddress(event.target.value)}
              />
              {strategyAddress.trim() && !hasStrategy && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Enter the full strategy address. Shortened values like `0x1234...abcd` will be rejected.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Card className="border border-border/70">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Vault Address</p>
                <div className="flex items-center gap-1">
                  <p className="text-lg font-semibold">{formatAddress(vaultInfo?.vaultAddress || selectedVault?.address || "")}</p>
                  <CopyButton address={vaultInfo?.vaultAddress || selectedVault?.address || ""} />
                </div>
                <Badge variant={vaultInfo?.paused ? "destructive" : "default"}>
                  {vaultInfo?.paused ? "Paused" : "Active"}
                </Badge>
              </CardContent>
            </Card>
            <Card className="border border-border/70">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Idle Assets</p>
                <p className="text-lg font-semibold">
                  {formatTokenAmount(vaultInfo?.idleAssets || "0", assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                </p>
                <p className="text-xs text-muted-foreground">Instantly held in the vault</p>
              </CardContent>
            </Card>
            <Card className="border border-border/70">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Max Deployable</p>
                <p className="text-lg font-semibold">
                  {formatTokenAmount(vaultInfo?.maxDeploy || "0", assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vaultInfo?.deployBlockedReason
                    ? `Deploy blocked: ${vaultInfo.deployBlockedReason}`
                    : `Min idle reserve: ${formatTokenAmount(vaultInfo?.minIdleRequirement || "0", assetDecimals)} ${vaultInfo?.assetSymbol || selectedVault?.assetSymbol}`}
                </p>
              </CardContent>
            </Card>
            <Card className="border border-border/70">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Deployed Assets</p>
                <p className="text-lg font-semibold">
                  {formatTokenAmount(vaultInfo?.deployedAssets || "0", assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                </p>
                <p className="text-xs text-muted-foreground">Capital currently out in strategies</p>
              </CardContent>
            </Card>
            <Card className="border border-border/70">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Queue Status</p>
                <p className="text-lg font-semibold">
                  {formatTokenAmount(vaultInfo?.totalQueuedShares || "0", assetDecimals)} {vaultInfo?.shareSymbol || selectedVault?.shareSymbol}
                </p>
                <p className="text-xs text-muted-foreground">
                  Claimable: {formatTokenAmount(vaultInfo?.totalClaimableAssets || "0", assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!hasOpenQueue || queueProcessableAssetsWei <= 0n || submittingAction !== null}
                  onClick={() =>
                    runAdminAction(
                      "process-queue",
                      () =>
                        api.post(`/earn/yield-vault/${selectedKey}/admin/process-queue`, {
                          maxRequests: "50",
                          maxAssets: queueProcessableAssetsWei.toString(),
                        }),
                      "Queue processed",
                      "Available idle assets were applied to queued withdrawals."
                    )
                  }
                >
                  {submittingAction === "process-queue" ? "Submitting..." : "Process Queue"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {hasOpenQueue
                    ? queueProcessableAssetsWei > 0n
                      ? `Can process up to ${formatTokenAmount(queueProcessableAssetsWei.toString(), assetDecimals)} ${vaultInfo?.assetSymbol || selectedVault?.assetSymbol} with current idle assets.`
                      : "Queue is open, but there are no free idle assets available to process it yet."
                    : "No queued withdrawals are currently waiting for processing."}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border border-border/70">
              <CardHeader>
                <CardTitle className="text-lg">Strategy Approval</CardTitle>
                <CardDescription>
                  Approve or revoke a strategy address before deploying capital.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={!hasStrategy || submittingAction !== null}
                    onClick={() =>
                      runAdminAction(
                        "approve",
                        () =>
                          api.post(`/earn/yield-vault/${selectedKey}/admin/strategy-approval`, {
                            strategy: normalizedStrategy,
                            approved: true,
                          }),
                        "Strategy approved",
                        "The strategy can now receive deployed capital."
                      )
                    }
                  >
                    {submittingAction === "approve" ? "Submitting..." : "Approve Strategy"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={!hasStrategy || submittingAction !== null}
                    onClick={() =>
                      runAdminAction(
                        "revoke",
                        () =>
                          api.post(`/earn/yield-vault/${selectedKey}/admin/strategy-approval`, {
                            strategy: normalizedStrategy,
                            approved: false,
                          }),
                        "Strategy revoked",
                        "The strategy can no longer receive new deployed capital."
                      )
                    }
                  >
                    {submittingAction === "revoke" ? "Submitting..." : "Revoke Strategy"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border/70">
              <CardHeader>
                <CardTitle className="text-lg">Min Idle Reserve</CardTitle>
                <CardDescription>
                  Set the vault&apos;s required idle reserve in basis points.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="yield-vault-min-idle">Min Idle Bps</Label>
                  <Input
                    id="yield-vault-min-idle"
                    placeholder="0 - 10000"
                    value={minIdleBps}
                    onChange={(event) => setMinIdleBps(event.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!minIdleValid || submittingAction !== null}
                  onClick={() =>
                    runAdminAction(
                      "min-idle",
                      () =>
                        api.post(`/earn/yield-vault/${selectedKey}/admin/min-idle-bps`, {
                          minIdleBps,
                        }),
                      "Min idle updated",
                      "The vault reserve requirement was updated."
                    )
                  }
                >
                  {submittingAction === "min-idle" ? "Submitting..." : "Save Min Idle"}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border border-border/70">
              <CardHeader>
                <CardTitle className="text-lg">Capital Movement</CardTitle>
                <CardDescription>
                  Deploy capital from the vault into an approved strategy.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="yield-vault-capital-amount">
                    Amount ({vaultInfo?.assetSymbol || selectedVault?.assetSymbol})
                  </Label>
                  <Input
                    id="yield-vault-capital-amount"
                    placeholder="0.00"
                    value={capitalAmount}
                    onChange={(event) => setCapitalAmount(event.target.value)}
                  />
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/30 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span>Current strategy debt</span>
                    <span className="font-medium text-foreground">
                      {formatTokenAmount(selectedStrategyDebtWei.toString(), assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    Deploying capital increases strategy debt and moves assets out of the vault.
                  </p>
                </div>
                <Button
                  className="w-full"
                  disabled={!hasStrategy || !hasCapitalAmount || submittingAction !== null}
                  onClick={() =>
                    runAdminAction(
                      "deploy",
                      () =>
                        api.post(`/earn/yield-vault/${selectedKey}/admin/deploy`, {
                          strategy: normalizedStrategy,
                          assets: capitalAmountWei.toString(),
                        }),
                      "Capital deployed",
                      "Capital was deployed to the selected strategy."
                    )
                  }
                >
                  {submittingAction === "deploy" ? "Submitting..." : "Deploy Capital"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border border-border/70">
              <CardHeader>
                <CardTitle className="text-lg">Loss Reporting</CardTitle>
                <CardDescription>
                  Write down strategy debt when assets are permanently lost. This is accounting-only and does not transfer tokens.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="yield-vault-loss-amount">
                    Loss ({vaultInfo?.assetSymbol || selectedVault?.assetSymbol})
                  </Label>
                  <Input
                    id="yield-vault-loss-amount"
                    placeholder="0.00"
                    value={lossAmount}
                    onChange={(event) => setLossAmount(event.target.value)}
                  />
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/30 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span>Current strategy debt</span>
                    <span className="font-medium text-foreground">
                      {formatTokenAmount(selectedStrategyDebtWei.toString(), assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Remaining debt after loss</span>
                    <span className="font-medium text-foreground">
                      {formatTokenAmount(remainingDebtAfterLossWei.toString(), assetDecimals)} {vaultInfo?.assetSymbol || selectedVault?.assetSymbol}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    Reporting loss writes down vault assets directly and lowers the exchange rate.
                  </p>
                  {lossExceedsDebt && (
                    <p className="text-red-600 dark:text-red-400">
                      Loss cannot exceed current strategy debt.
                    </p>
                  )}
                </div>
                <Button
                  className="w-full"
                  variant="destructive"
                  disabled={!hasStrategy || !hasLossAmount || lossExceedsDebt || submittingAction !== null}
                  onClick={() =>
                    runAdminAction(
                      "loss",
                      () =>
                        api.post(`/earn/yield-vault/${selectedKey}/admin/report-loss`, {
                          strategy: normalizedStrategy,
                          loss: lossAmountWei.toString(),
                        }),
                      "Loss reported",
                      "Strategy debt and deployed assets were written down."
                    )
                  }
                >
                  {submittingAction === "loss" ? "Submitting..." : "Report Strategy Loss"}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="border border-border/70">
            <CardHeader>
              <CardTitle className="text-lg">Active Strategy Holdings</CardTitle>
              <CardDescription>
                Live `strategyDebt` entries currently tracked by the vault.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {vaultInfo?.strategyHoldings?.length ? (
                vaultInfo.strategyHoldings.map((holding) => (
                  <div
                    key={holding.strategyAddress}
                    className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">Strategy</p>
                      <div className="flex items-center gap-1">
                        <p className="font-medium break-all">{holding.strategyAddress}</p>
                        <CopyButton address={holding.strategyAddress} />
                      </div>
                    </div>
                    <div className="sm:text-right space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStrategyAddress(holding.strategyAddress)}
                      >
                        Use Address
                      </Button>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-xs text-muted-foreground">Deployed</p>
                      <p className="font-semibold">
                        {formatTokenAmount(holding.deployedAssets, assetDecimals)} {vaultInfo.assetSymbol}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No active strategy debt on this vault.</p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
};

export default YieldVaultAdminTab;
