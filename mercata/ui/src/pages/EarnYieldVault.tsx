import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft, CircleDollarSign, TrendingUp, Wallet } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import CopyButton from "@/components/ui/copy";
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
import { useYieldVaultContext } from "@/hooks/useYieldVaultContext";
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

const formatBps = (value: string): string => {
  const num = Number(value || "0");
  if (!Number.isFinite(num)) return "0.00%";
  return `${(num / 100).toFixed(2)}%`;
};

const formatAddress = (value: string): string => {
  const raw = (value || "").replace(/^0x/, "");
  if (!raw) return "--";
  if (raw.length <= 10) return `0x${raw}`;
  return `0x${raw.slice(0, 6)}...${raw.slice(-4)}`;
};

const previewAssetsForShares = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  if (shares <= 0n) return 0n;
  if (totalAssets <= 0n || totalShares <= 0n) return totalShares <= 0n ? shares : 0n;
  return (shares * (totalAssets + 1n)) / (totalShares + 1n);
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
  const maxRedeemShares = userInfo?.maxRedeem || "0";
  const maxWithdrawAssets = userInfo?.maxWithdraw || "0";
  const claimableAssets = userInfo?.claimableAssets || "0";
  const pendingWithdrawal = userInfo?.pendingWithdrawal || null;
  const hasPendingWithdrawal = Boolean(pendingWithdrawal);
  const hasClaimableAssets = BigInt(claimableAssets || "0") > 0n;
  const strategyHoldings = effectiveInfo?.strategyHoldings || [];

  const decimals = effectiveInfo?.decimals ?? 18;

  const depositDisabled = !isLoggedIn || !isDeployed;
  const redeemDisabled = !isLoggedIn || !isDeployed || hasPendingWithdrawal;

  const amountWei = actionAmount ? safeParseUnits(actionAmount, decimals) : 0n;
  const actionMaxWei = useMemo(() => {
    if (actionMode === "deposit") return BigInt(userInfo?.maxDeposit || "0");
    if (actionMode === "redeem") return BigInt(userInfo?.userShares || "0");
    return 0n;
  }, [actionMode, userInfo?.maxDeposit, userInfo?.userShares]);

  const totalAssetsBig = BigInt(effectiveInfo?.totalAssets || "0");
  const totalSharesBig = BigInt(effectiveInfo?.totalShares || "0");

  const previewValueWei = useMemo(() => {
    if (amountWei <= 0n) return 0n;

    if (actionMode === "deposit") {
      if (totalAssetsBig <= 0n || totalSharesBig <= 0n) return amountWei;
      return (amountWei * (totalSharesBig + 1n)) / (totalAssetsBig + 1n);
    }
    if (actionMode === "redeem") {
      if (totalAssetsBig <= 0n || totalSharesBig <= 0n) return 0n;
      return (amountWei * (totalAssetsBig + 1n)) / (totalSharesBig + 1n);
    }
    return 0n;
  }, [actionMode, amountWei, totalAssetsBig, totalSharesBig]);

  const instantWithdrawSharesWei = useMemo(() => {
    if (actionMode !== "redeem" || amountWei <= 0n) return 0n;
    const instantMaxShares = BigInt(maxRedeemShares || "0");
    return amountWei <= instantMaxShares ? amountWei : 0n;
  }, [actionMode, amountWei, maxRedeemShares]);

  const queuedWithdrawSharesWei = useMemo(() => {
    if (actionMode !== "redeem" || amountWei <= 0n) return 0n;
    const instantMaxShares = BigInt(maxRedeemShares || "0");
    return amountWei > instantMaxShares ? amountWei : 0n;
  }, [actionMode, amountWei, maxRedeemShares]);

  const instantWithdrawAssetsWei = useMemo(
    () => previewAssetsForShares(instantWithdrawSharesWei, totalAssetsBig, totalSharesBig),
    [instantWithdrawSharesWei, totalAssetsBig, totalSharesBig]
  );

  const queuedWithdrawAssetsEstimateWei = useMemo(
    () => previewAssetsForShares(queuedWithdrawSharesWei, totalAssetsBig, totalSharesBig),
    [queuedWithdrawSharesWei, totalAssetsBig, totalSharesBig]
  );

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
      } else {
        await api.post(`/earn/yield-vault/${vaultKey}/redeem`, {
          sharesAmount: amountWei.toString(),
        });
        toast({
          title: "Withdraw submitted",
          description:
            queuedWithdrawSharesWei > 0n
              ? `This withdrawal exceeds instant capacity, so the full request was placed in the queue.`
              : `Withdrawing ${actionAmount} ${shareSymbol} back to ${assetSymbol}.`,
          variant: "success",
        });
      }
      setActionMode(null);
      await refreshVaults();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Transaction failed";
      toast({ title: `${actionMode === "deposit" ? "Deposit" : "Redeem"} failed`, description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClaim = async () => {
    if (isSubmitting || !hasClaimableAssets) return;
    try {
      setIsSubmitting(true);
      await api.post(`/earn/yield-vault/${vaultKey}/claim`);
      toast({
        title: "Claim submitted",
        description: `Claiming ${formatTokenAmount(claimableAssets, decimals)} ${assetSymbol}.`,
        variant: "success",
      });
      await refreshVaults();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Claim failed";
      toast({ title: "Claim failed", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRedeemAll = async () => {
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);
      await api.post(`/earn/yield-vault/${vaultKey}/redeem-all`);
      toast({
        title: "Withdraw submitted",
        description:
          BigInt(userShares || "0") > BigInt(maxRedeemShares || "0")
            ? `This withdrawal exceeds instant capacity, so the full request was placed in the queue.`
            : `Withdrawing your full ${shareSymbol} balance back to ${assetSymbol}.`,
        variant: "success",
      });
      setActionMode(null);
      await refreshVaults();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Redeem failed";
      toast({ title: "Redeem failed", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const actionPrimaryLabel =
    actionMode === "deposit" ? `Deposit ${assetSymbol}` : `Withdraw ${shareSymbol}`;
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
                            Total value locked in the vault
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
                          Deposit {assetSymbol}
                        </Button>
                        <Button
                          variant="outline"
                          className="sm:min-w-[180px]"
                          onClick={() => handleActionRequest("redeem")}
                          disabled={redeemDisabled}
                        >
                          Withdraw {shareSymbol}
                        </Button>
                      </div>
                      {!isDeployed && (
                        <p className="text-xs text-muted-foreground">
                          This vault is not deployed on this network yet.
                        </p>
                      )}
                      {hasPendingWithdrawal && (
                        <p className="text-xs text-muted-foreground">
                          You already have a queued withdrawal. Claim it once processed, or wait for the queue to clear before starting another withdrawal.
                        </p>
                      )}
                    </CardContent>
                  </Card>
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

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Vault Parameters</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Vault Address</p>
                        <div className="flex items-center gap-1">
                          <p className="text-lg font-semibold break-all">{formatAddress(effectiveInfo?.vaultAddress || "")}</p>
                          <CopyButton address={effectiveInfo?.vaultAddress || ""} />
                        </div>
                        <p className="text-xs text-muted-foreground">Configured carryETH vault on this network</p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Idle Assets</p>
                        <p className="text-lg font-semibold">
                          {formatTokenAmount(effectiveInfo?.idleAssets || "0", decimals)} {assetSymbol}
                        </p>
                        <p className="text-xs text-muted-foreground">Currently available inside the vault</p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Deployed Assets</p>
                        <p className="text-lg font-semibold">
                          {formatTokenAmount(effectiveInfo?.deployedAssets || "0", decimals)} {assetSymbol}
                        </p>
                        <p className="text-xs text-muted-foreground">Capital deployed to the carry strategy</p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Min Idle Reserve</p>
                        <p className="text-lg font-semibold">{formatBps(effectiveInfo?.minIdleBps || "0")}</p>
                        <p className="text-xs text-muted-foreground">
                          Queue: {BigInt(effectiveInfo?.totalQueuedShares || "0") > 0n ? "open" : "clear"}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Strategy Holdings</h2>
                  {strategyHoldings.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3">
                      {strategyHoldings.map((holding) => (
                        <Card key={holding.strategyAddress} className="border border-border/70">
                          <CardContent className="pt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Strategy Address</p>
                              <div className="flex items-center gap-1">
                                <p className="text-sm font-medium break-all">{formatAddress(holding.strategyAddress)}</p>
                                <CopyButton address={holding.strategyAddress} />
                              </div>
                            </div>
                            <div className="space-y-1 sm:text-right">
                              <p className="text-xs text-muted-foreground">Deployed Capital</p>
                              <p className="text-lg font-semibold">
                                {formatTokenAmount(holding.deployedAssets, decimals)} {assetSymbol}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-sm font-medium">No active deployed strategy holdings</p>
                        <p className="text-xs text-muted-foreground">
                          This view shows the vault&apos;s on-chain capital deployed to approved strategy addresses. It does not include the strategy&apos;s internal asset mix.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Withdrawal Status</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Withdrawable Instantly</p>
                        <p className="text-2xl font-semibold">
                          {isLoggedIn ? formatTokenAmount(maxWithdrawAssets, decimals) : "--"} {isLoggedIn ? assetSymbol : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isLoggedIn
                            ? `${formatTokenAmount(maxRedeemShares, decimals)} ${shareSymbol} can exit right now`
                            : "Sign in to view your instant exit capacity"}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Estimated Pending Claim</p>
                        <p className="text-2xl font-semibold">
                          {pendingWithdrawal
                            ? `${formatTokenAmount(pendingWithdrawal.estimatedAssets, decimals)} ${assetSymbol}`
                            : "--"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {pendingWithdrawal
                            ? `${formatTokenAmount(pendingWithdrawal.shares, decimals)} ${shareSymbol} currently queued. Estimated at the current exchange rate.`
                            : "No queued withdrawal"}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-3">
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Claimable Now</p>
                          <p className="text-2xl font-semibold">
                            {isLoggedIn ? formatTokenAmount(claimableAssets, decimals) : "--"} {isLoggedIn ? assetSymbol : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Processed withdrawals waiting to be claimed
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={!hasClaimableAssets || isSubmitting}
                          onClick={handleClaim}
                        >
                          Claim {assetSymbol}
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </section>

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
                : `Withdraw ${shareSymbol} back into ${assetSymbol}. Any amount above the instant limit will be placed in the withdrawal queue.`}
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
              <div className="rounded-lg border border-border/70 bg-background/60 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span>Withdrawable instantly</span>
                  <span className="font-medium text-foreground">
                    {formatTokenAmount(instantWithdrawAssetsWei.toString(), decimals)} {assetSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Estimated queued</span>
                  <span className="font-medium text-foreground">
                    {formatTokenAmount(queuedWithdrawAssetsEstimateWei.toString(), decimals)} {assetSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total position claim</span>
                  <span className="font-medium text-foreground">
                    {formatTokenAmount(redeemableAssets, decimals)} {assetSymbol}
                    {BigInt(userInfo?.assetPriceWad || "0") > 0n || BigInt(positionUsdWad || "0") > 0n ? (
                      <> (~ {formatUsdAmount(positionUsdWad)})</>
                    ) : null}
                  </span>
                </div>
                {queuedWithdrawSharesWei > 0n && (
                  <p className="text-muted-foreground">
                    The queued portion remains pending until the vault processes withdrawals. Once processed, it will appear in Claimable Now above.
                  </p>
                )}
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
              {actionMode === "redeem" && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={BigInt(userInfo?.userShares || "0") <= 0n || isSubmitting || hasPendingWithdrawal}
                  onClick={handleRedeemAll}
                >
                  Withdraw All
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EarnYieldVault;
