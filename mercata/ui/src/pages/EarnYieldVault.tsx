import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft, CircleDollarSign, Clock, TrendingUp, Wallet } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/context/UserContext";
import { useYieldVaultContext } from "@/context/YieldVaultContext";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import { safeParseUnits } from "@/utils/numberUtils";

const VAULT_META: Record<string, {
  title: string;
  subtitle: string;
  iconBg: string;
  iconColor: string;
  cardBorder: string;
  strategyDescription: string;
}> = {
  "eth-carry": {
    title: "ETH Carry Vault",
    subtitle: "ERC-4626 carry vault for ETH deposits",
    iconBg: "bg-indigo-500/15 dark:bg-indigo-400/15",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    cardBorder: "border-indigo-500/25 dark:border-indigo-400/25 bg-gradient-to-br from-[#f5f3ff] to-[#ede9fe] dark:from-[#1a1533] dark:to-[#1c173a]",
    strategyDescription: "The vault targets growth in ETH per share. Deposited ETH is wrapped into wstETH to earn staking yield, then used as collateral to borrow USDST. Borrowed stables are deployed into yield-bearing stablecoins (syrupUSDC, sUSDS), and the net carry is periodically converted back into ETH, increasing each share's claim on ETH over time. The vault maintains an idle buffer for withdrawals; large redemptions may queue when capital is deployed.",
  },
  "wbtc-carry": {
    title: "wBTC Carry Vault",
    subtitle: "ERC-4626 carry vault for wBTC deposits",
    iconBg: "bg-orange-500/15 dark:bg-orange-400/15",
    iconColor: "text-orange-600 dark:text-orange-400",
    cardBorder: "border-orange-500/25 dark:border-orange-400/25 bg-gradient-to-br from-[#fff7ed] to-[#ffedd5] dark:from-[#241a0a] dark:to-[#2b1d0c]",
    strategyDescription: "The vault targets growth in BTC per share. Deposited wBTC is used as collateral to borrow USDST, which is deployed into yield-bearing stablecoins (syrupUSDC, sUSDS). The net carry is periodically converted back into BTC, increasing each share's claim on BTC over time. The vault maintains an idle buffer for withdrawals; large redemptions may queue when capital is deployed.",
  },
};

const formatTokenAmount = (value: string, decimals: number = 18, maxFractionDigits: number = 4): string => {
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

const formatExchangeRate = (exchangeRate: string, assetSymbol: string): string => {
  try {
    const num = Number(formatUnits(exchangeRate || "0", 18));
    if (!Number.isFinite(num)) return "-";
    return `${num.toFixed(4)} ${assetSymbol}`;
  } catch {
    return "-";
  }
};

const formatPercent = (value: string): string => {
  if (!value || value === "-") return "-";
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(2)}%`;
};

const formatUsdAmount = (value: string): string => {
  try {
    const num = Number(formatUnits(value || "0", 18));
    if (!Number.isFinite(num)) return "$0.00";
    return num.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "$0.00";
  }
};

/** Oracle USD (WAD) from underlying base units — matches backend `underlyingUsdWad` / TVL / positionUsd. */
const underlyingUsdWad = (amountWei: bigint, priceWad: bigint, d: number): bigint => {
  if (priceWad <= 0n || amountWei <= 0n) return 0n;
  const unit = 10n ** BigInt(d);
  return (amountWei * priceWad) / unit;
};

type ActionMode = "deposit" | "redeem" | null;

const EarnYieldVault = () => {
  const [searchParams] = useSearchParams();
  const vaultKey = searchParams.get("vault") ?? "";
  const meta = VAULT_META[vaultKey] ?? null;

  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const { getVaultInfo, getUserVaultInfo, loading: loadingVaults, refreshVaults } = useYieldVaultContext();

  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [actionAmount, setActionAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect to earn page if vault key is unknown.
  useEffect(() => {
    if (!meta) navigate("/dashboard/earn", { replace: true });
  }, [meta, navigate]);

  const vaultInfo = getVaultInfo(vaultKey);
  const userInfo = getUserVaultInfo(vaultKey);
  const effectiveInfo = userInfo || vaultInfo;

  useEffect(() => {
    if (meta) {
      document.title = `${meta.title} | STRATO`;
      window.scrollTo(0, 0);
    }
  }, [meta]);

  useEffect(() => {
    if (!actionMode) setActionAmount("");
  }, [actionMode]);

  const isDeployed = Boolean(effectiveInfo?.deployed);
  const assetSymbol = effectiveInfo?.assetSymbol || "Asset";
  const shareSymbol = effectiveInfo?.shareSymbol || "Shares";
  const exchangeRate = formatExchangeRate(effectiveInfo?.exchangeRate || "0", assetSymbol);
  const tvlDisplay = loadingVaults ? "..." : formatUsdAmount(effectiveInfo?.tvlUsd || "0");
  const apyDisplay = (() => {
    if (loadingVaults) return "...";
    const raw = effectiveInfo?.apy ?? "-";
    if (isDeployed) {
      const n = Number(raw);
      if (!raw || raw === "-" || !Number.isFinite(n) || n === 0) return "—";
    }
    return formatPercent(typeof raw === "string" ? raw : String(raw));
  })();
  const userShares = userInfo?.userShares || "0";
  const redeemableAssets = userInfo?.redeemableAssets || "0";
  const positionUsdWad = userInfo?.positionUsd || "0";
  const walletAssets = userInfo?.walletAssets || "0";

  const decimals = effectiveInfo?.decimals ?? 18;

  const totalAssetsWei = effectiveInfo?.totalAssets || "0";
  const idleAssetsWei = effectiveInfo?.idleAssets || "0";
  const activeAssetsWei = effectiveInfo?.activeAssets || "0";
  const totalSharesWei = effectiveInfo?.totalShares || "0";
  /** Total = idle + deployed on-chain; use extra decimals when they differ so rounding does not hide it. */
  const vaultDetailAmountDigits =
    BigInt(totalAssetsWei) !== BigInt(idleAssetsWei) ? 8 : 4;
  const totalQueuedSharesWei = effectiveInfo?.totalQueuedShares || "0";
  const totalClaimableAssetsWei = effectiveInfo?.totalClaimableAssets || "0";
  /** Matches contract freeIdleForInstantWithdrawals(): 0 when queue active, else idle − claimable. */
  const freeIdleWei = (() => {
    if (BigInt(totalQueuedSharesWei) > 0n) return "0";
    const idle = BigInt(idleAssetsWei);
    const claimable = BigInt(totalClaimableAssetsWei);
    return (idle > claimable ? idle - claimable : 0n).toString();
  })();
  const isPaused = Boolean(effectiveInfo?.paused);

  const claimableAssetsWei = userInfo?.claimableAssets || "0";
  const hasClaimable = isLoggedIn && BigInt(claimableAssetsWei) > 0n;
  const hasQueuedRequest = isLoggedIn && BigInt(userInfo?.activeRequestId || "0") > 0n;
  const queuedSharesWei = userInfo?.queuedShares || "0";

  const assetPriceWadStr = effectiveInfo?.assetPriceWad || "0";
  const claimUsdWad = useMemo(() => {
    return underlyingUsdWad(
      BigInt(claimableAssetsWei || "0"),
      BigInt(assetPriceWadStr || "0"),
      decimals
    ).toString();
  }, [claimableAssetsWei, assetPriceWadStr, decimals]);
  /** Preview underlying for queued shares — same (shares × (activeAssets+1)) / (totalShares+1) as backend redeemable calc. */
  const queuedUnderlyingUsdWad = useMemo(() => {
    const qs = BigInt(queuedSharesWei || "0");
    const aa = BigInt(activeAssetsWei || "0");
    const ts = BigInt(totalSharesWei || "0");
    const p = BigInt(assetPriceWadStr || "0");
    if (qs <= 0n || ts <= 0n) return "0";
    const underlyingWei = (qs * (aa + 1n)) / (ts + 1n);
    return underlyingUsdWad(underlyingWei, p, decimals).toString();
  }, [queuedSharesWei, activeAssetsWei, totalSharesWei, assetPriceWadStr, decimals]);

  const depositDisabled = !isLoggedIn || !isDeployed || isPaused;
  const redeemDisabled = !isLoggedIn || !isDeployed || isPaused;

  const amountWei = actionAmount ? safeParseUnits(actionAmount, decimals) : 0n;
  const actionMaxWei = useMemo(() => {
    if (actionMode === "deposit") return BigInt(userInfo?.maxDeposit || "0");
    if (actionMode === "redeem") return BigInt(userInfo?.userShares || "0");
    return 0n;
  }, [actionMode, userInfo?.maxDeposit, userInfo?.userShares]);

  const previewValueWei = useMemo(() => {
    const activeAssetsBig = BigInt(effectiveInfo?.activeAssets || "0");
    const totalSharesBig = BigInt(effectiveInfo?.totalShares || "0");
    if (amountWei <= 0n) return 0n;

    if (actionMode === "deposit") {
      if (activeAssetsBig <= 0n || totalSharesBig <= 0n) return amountWei;
      return (amountWei * (totalSharesBig + 1n)) / (activeAssetsBig + 1n);
    }
    if (actionMode === "redeem") {
      if (activeAssetsBig <= 0n || totalSharesBig <= 0n) return 0n;
      return (amountWei * (activeAssetsBig + 1n)) / (totalSharesBig + 1n);
    }
    return 0n;
  }, [actionMode, amountWei, effectiveInfo?.activeAssets, effectiveInfo?.totalShares]);

  const isActionAmountValid = amountWei > 0n && amountWei <= actionMaxWei;

  const handleActionRequest = (mode: Exclude<ActionMode, null>) => {
    if (!isLoggedIn) {
      toast({
        title: "Sign in required",
        description: `Connect your account to deposit or redeem ${shareSymbol}.`,
        variant: "destructive",
      });
      return;
    }
    setActionMode(mode);
  };

  const handleSubmit = async () => {
    if (!actionMode || !isActionAmountValid || isSubmitting) return;
    try {
      setIsSubmitting(true);
      if (actionMode === "deposit") {
        await api.post(`/earn/yield-vault/${vaultKey}/deposit`, {
          amount: amountWei.toString(),
        });
        toast({
          title: "Deposit submitted",
          description: `Depositing ${actionAmount} ${assetSymbol} into ${shareSymbol}.`,
          variant: "success",
        });
      } else if (actionMode === "redeem") {
        await api.post(`/earn/yield-vault/${vaultKey}/redeem`, {
          sharesAmount: amountWei.toString(),
        });
        toast({
          title: "Redeem submitted",
          description: `Redeeming ${actionAmount} ${shareSymbol}. If vault liquidity is sufficient you will receive ${assetSymbol} instantly, otherwise the withdrawal will be queued.`,
          variant: "success",
        });
      }
      setActionMode(null);
      await refreshVaults();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Transaction failed";
      const actionLabel = actionMode === "deposit" ? "Deposit" : "Redeem";
      toast({ title: `${actionLabel} failed`, description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleClaim = async () => {
    if (!isLoggedIn || isSubmitting) return;
    try {
      setIsSubmitting(true);
      await api.post(`/earn/yield-vault/${vaultKey}/claim`);
      toast({
        title: "Claim submitted",
        description: `Claiming ${formatTokenAmount(claimableAssetsWei, decimals)} ${assetSymbol}.`,
        variant: "success",
      });
      await refreshVaults();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Transaction failed";
      toast({ title: "Claim failed", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!isLoggedIn || isSubmitting) return;
    try {
      setIsSubmitting(true);
      await api.post(`/earn/yield-vault/${vaultKey}/cancel-request`);
      toast({
        title: "Request cancelled",
        description: `Your queued withdrawal has been cancelled and shares returned.`,
        variant: "success",
      });
      await refreshVaults();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Transaction failed";
      toast({ title: "Cancel failed", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const actionPrimaryLabel = actionMode === "deposit" ? "Deposit" : "Redeem";
  const actionPreviewSymbol = actionMode === "deposit" ? shareSymbol : assetSymbol;
  const actionMaxInputValue =
    actionMode === "deposit"
      ? formatUnits(userInfo?.maxDeposit || "0", decimals)
      : formatUnits(userInfo?.userShares || "0", decimals);
  const actionMaxLabel =
    actionMode === "deposit"
      ? formatTokenAmount(userInfo?.maxDeposit || "0", decimals)
      : formatTokenAmount(userInfo?.userShares || "0", decimals);

  if (loadingVaults && !effectiveInfo) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardSidebar />
        <div
          className="transition-all duration-300 md:pl-64"
          style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
        >
          <DashboardHeader title={meta.title} />
          <main className="p-4 md:p-6 pb-16 md:pb-6 space-y-6">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </main>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  const metrics = [
    {
      label: `${assetSymbol} Balance`,
      value: loadingVaults ? "..." : isLoggedIn ? formatTokenAmount(walletAssets, decimals) : "--",
      hint: "Available to deposit",
      icon: <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
    },
    {
      label: `Your ${shareSymbol}`,
      value: loadingVaults ? "..." : isLoggedIn ? formatTokenAmount(userShares, decimals) : "--",
      hint: "Vault shares held",
      icon: <TrendingUp className={`h-4 w-4 ${meta.iconColor}`} />,
    },
    {
      label: "Position Value",
      value: loadingVaults
        ? "..."
        : isLoggedIn
          ? (() => {
              const sharesBn = BigInt(userShares || "0");
              const priceBn = BigInt(userInfo?.assetPriceWad || "0");
              const usdPart = formatUsdAmount(positionUsdWad);
              if (sharesBn <= 0n) return "--";
              if (priceBn <= 0n && BigInt(positionUsdWad || "0") <= 0n) return "--";
              const underlyingHint = `${formatTokenAmount(redeemableAssets, decimals)} ${assetSymbol}`;
              return `${usdPart} (${underlyingHint})`;
            })()
          : "--",
      hint: "NAV: share claim × exchange ratio × oracle price",
      icon: <CircleDollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title={meta.title} />

        <main className="pb-16 md:pb-6">
          {!isLoggedIn && (
            <GuestSignInBanner
              message={`Sign in to view your ${assetSymbol} balance and vault position.`}
            />
          )}

          <div className="w-full">
            <Card className="bg-card border-0 rounded-none">
              <CardContent className="p-4 md:p-6 space-y-8">
                <button
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => navigate("/dashboard/earn")}
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Earn
                </button>

                <section className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                      Carry Vault
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {assetSymbol}
                    </Badge>
                    {!isDeployed && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Not Deployed
                      </Badge>
                    )}
                    {isPaused && (
                      <Badge variant="destructive" className="text-[10px] uppercase tracking-wide">
                        Paused
                      </Badge>
                    )}
                  </div>

                  <Card className={`border ${meta?.cardBorder ?? ""}`}>
                    <CardContent className="pt-5 space-y-5">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-12 h-12 rounded-full ${meta.iconBg} flex items-center justify-center`}
                          >
                            <TrendingUp className={`h-6 w-6 ${meta.iconColor}`} />
                          </div>
                          <div>
                            <h1 className="text-2xl md:text-4xl font-semibold tracking-tight">
                              {meta.title}
                            </h1>
                            <p className="text-sm md:text-base text-muted-foreground">
                              {meta.subtitle}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-muted-foreground">Exchange Rate</p>
                          <p className="mt-1 text-lg font-semibold">{exchangeRate}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {assetSymbol} redeemable per {shareSymbol}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-muted-foreground">TVL</p>
                          <p className="mt-1 text-lg font-semibold">{tvlDisplay}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {loadingVaults ? "" : `${formatTokenAmount(totalSharesWei, decimals)} ${shareSymbol} outstanding`}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-muted-foreground">Yield</p>
                          <p className="mt-1 text-lg font-semibold">{apyDisplay}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Estimated annualized yield
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                          className="sm:min-w-[180px]"
                          onClick={() => handleActionRequest("deposit")}
                          disabled={depositDisabled}
                        >
                          Deposit
                        </Button>
                        <Button
                          variant="outline"
                          className="sm:min-w-[180px]"
                          onClick={() => handleActionRequest("redeem")}
                          disabled={redeemDisabled}
                        >
                          Redeem
                        </Button>
                      </div>
                      {!isDeployed && (
                        <p className="text-xs text-muted-foreground">
                          This vault is not deployed on this network yet.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section className="space-y-3">
                  <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Vault Details</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Total Assets</p>
                      <p className="mt-1 text-lg font-semibold">
                        {loadingVaults
                          ? "..."
                          : formatTokenAmount(totalAssetsWei, decimals, vaultDetailAmountDigits)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{assetSymbol}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Idle / Available</p>
                      <p className="mt-1 text-lg font-semibold">
                        {loadingVaults
                          ? "..."
                          : formatTokenAmount(freeIdleWei, decimals, vaultDetailAmountDigits)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{assetSymbol} for instant withdrawals</p>
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {metrics.map((metric) => (
                    <Card key={metric.label} className="border border-border/70">
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">{metric.label}</p>
                          {metric.icon}
                        </div>
                        <p className="text-2xl font-semibold leading-none">{metric.value}</p>
                        <p className="text-xs text-muted-foreground">{metric.hint}</p>
                      </CardContent>
                    </Card>
                  ))}
                </section>

                {(hasQueuedRequest || hasClaimable) && (
                  <section>
                    <Card className={hasClaimable
                      ? "border border-green-500/30 bg-green-50/50 dark:bg-green-950/20"
                      : "border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20"
                    }>
                      <CardContent className="pt-4 pb-4 flex items-start gap-3">
                        {hasClaimable
                          ? <CircleDollarSign className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                          : <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        }
                        <div className="flex-1 space-y-1">
                          {hasClaimable ? (
                            <>
                              <p className="text-sm font-medium">
                                Claimable: {formatTokenAmount(claimableAssetsWei, decimals)} {assetSymbol}
                                {BigInt(claimUsdWad) > 0n && (
                                  <span className="text-muted-foreground font-normal">
                                    {" "}
                                    ({formatUsdAmount(claimUsdWad)})
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Your withdrawal has been processed. Claim your {assetSymbol} below.
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-medium">
                                Withdrawal Queued: {formatTokenAmount(queuedSharesWei, decimals)} {shareSymbol}
                                {BigInt(queuedUnderlyingUsdWad) > 0n && (
                                  <span className="text-muted-foreground font-normal">
                                    {" "}
                                    (~{formatUsdAmount(queuedUnderlyingUsdWad)})
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Your shares are queued for withdrawal and will be processed when capital is returned.
                              </p>
                            </>
                          )}
                        </div>
                        {hasClaimable ? (
                          <Button
                            size="sm"
                            className="shrink-0"
                            onClick={handleClaim}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? "..." : "Claim"}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-amber-700 dark:text-amber-400 border-amber-400/50 hover:bg-amber-100 dark:hover:bg-amber-950/40"
                            onClick={handleCancelRequest}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? "..." : "Cancel"}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </section>
                )}

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Strategy</h2>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                    {meta?.strategyDescription}
                  </p>
                </section>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <MobileBottomNav />

      <Dialog
        open={actionMode !== null}
        onOpenChange={(open) => (!open ? setActionMode(null) : undefined)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{actionPrimaryLabel}</DialogTitle>
            <DialogDescription>
              {actionMode === "deposit"
                ? `Deposit ${assetSymbol} into the vault and receive ${shareSymbol} shares.`
                : `Redeem ${shareSymbol} shares for the underlying ${assetSymbol}. If vault liquidity covers the amount you will receive ${assetSymbol} instantly, otherwise the withdrawal will be queued until capital is returned.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span>Available</span>
                <button
                  type="button"
                  className="font-medium text-foreground hover:underline"
                  onClick={() =>
                    setActionAmount(
                      actionMaxInputValue === "0.0" || actionMaxInputValue === "0"
                        ? ""
                        : actionMaxInputValue
                    )
                  }
                >
                  Max: {actionMaxLabel}
                </button>
              </div>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={actionAmount}
                onChange={(event) => setActionAmount(event.target.value)}
              />
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span>{assetSymbol} Balance</span>
                <span className="font-medium text-foreground">
                  {formatTokenAmount(walletAssets, decimals)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{shareSymbol} Balance</span>
                <span className="font-medium text-foreground">
                  {formatTokenAmount(userShares, decimals)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>You receive</span>
                <span className="font-medium text-foreground">
                  {formatTokenAmount(previewValueWei.toString(), decimals)} {actionPreviewSymbol}
                </span>
              </div>
            </div>
            {actionMode === "redeem" && (
              <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs space-y-1">
                <p>
                  Position claim:{" "}
                  {formatTokenAmount(redeemableAssets, decimals, vaultDetailAmountDigits)} {assetSymbol}
                  {BigInt(userInfo?.assetPriceWad || "0") > 0n || BigInt(positionUsdWad || "0") > 0n ? (
                    <> (~ {formatUsdAmount(positionUsdWad)})</>
                  ) : null}
                </p>
                <p className="text-muted-foreground">
                  {BigInt(freeIdleWei) <= 0n
                    ? "No idle liquidity available — redemptions will be queued."
                    : `Free idle: ${formatTokenAmount(freeIdleWei, decimals, vaultDetailAmountDigits)} ${assetSymbol}. Redemptions exceeding free idle will be queued.`}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                disabled={!isActionAmountValid || isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting ? "Submitting..." : actionPrimaryLabel}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EarnYieldVault;
