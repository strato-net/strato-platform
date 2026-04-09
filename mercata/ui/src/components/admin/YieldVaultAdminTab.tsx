import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "ethers";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import { safeParseUnits, ensureHexPrefix } from "@/utils/numberUtils";
import { YieldVaultInfo } from "@/context/YieldVaultContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const hasStrategy = Boolean(normalizedStrategy);
  const hasCapitalAmount = capitalAmountWei > 0n;
  const hasLossAmount = lossAmountWei > 0n;
  const minIdleValue = minIdleBps.trim();
  const minIdleValid =
    /^\d+$/.test(minIdleValue) && Number(minIdleValue) >= 0 && Number(minIdleValue) <= 10000;

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
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border border-border/70">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Vault Address</p>
                <p className="text-lg font-semibold">{formatAddress(vaultInfo?.vaultAddress || selectedVault?.address || "")}</p>
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
                  Deploy capital to a strategy or return principal/profit back to the vault. `returnCapital` only works if the strategy has assets and has approved the vault to pull them.
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
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
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
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={!hasStrategy || !hasCapitalAmount || submittingAction !== null}
                    onClick={() =>
                      runAdminAction(
                        "return",
                        () =>
                          api.post(`/earn/yield-vault/${selectedKey}/admin/return`, {
                            strategy: normalizedStrategy,
                            assets: capitalAmountWei.toString(),
                          }),
                        "Capital return submitted",
                        "The vault will pull the specified assets back from the strategy."
                      )
                    }
                  >
                    {submittingAction === "return" ? "Submitting..." : "Return Capital"}
                  </Button>
                </div>
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
                <Button
                  className="w-full"
                  variant="destructive"
                  disabled={!hasStrategy || !hasLossAmount || submittingAction !== null}
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
                      <p className="font-medium">{formatAddress(holding.strategyAddress)}</p>
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
