import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatUnits } from "ethers";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, ChevronDown, CircleDollarSign, Sparkles, TrendingUp, Wallet } from "lucide-react";

// Mirrors backend OFF_CHAIN_DISPLAY_FLOOR_USD: hide the off-chain section when
// the pooled value is below this so transient slippage/oracle dust doesn't
// noise up the strategy card.
const OFF_CHAIN_DISPLAY_FLOOR_USD = 100;
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
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import {
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { useEarnContext } from "@/context/EarnContext";
import { findBestEarnApyInfo } from "@/utils/earnUtils";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { BestApyInfoTooltip } from "@/components/earn/BestApyInfoTooltip";
import { YieldVaultHistoryCharts } from "@/components/earn/YieldVaultHistoryCharts";
import type { YieldVaultHistoryPoint } from "@/context/YieldVaultContext";

const VAULT_META: Record<string, {
  title: string;
  subtitle: string;
  badge: string;
  iconBg: string;
  iconColor: string;
  cardBorder: string;
  strategyDescription: string;
}> = {
  "eth-carry": {
    title: "ETH Yield Vault",
    subtitle: "Earn ETH yield and Reward Points",
    badge: "Yield Vault",
    iconBg: "bg-indigo-500/15 dark:bg-indigo-400/15",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    cardBorder: "border-primary/25 bg-gradient-to-br from-primary/5 to-muted",
    strategyDescription: "Deposited ETH is put to work across approved yield strategies, including wstETH staking yield. Net strategy returns are converted to ETH, which funds the vault’s configured Base APY. Funded rewards increase the ETH value of each vault share over time. The vault maintains an idle buffer for withdrawals; larger redemptions may queue while capital is deployed.",
  },
  "wbtc-carry": {
    title: "wBTC Carry Vault",
    subtitle: "ERC-4626 carry vault for wBTC deposits",
    badge: "Carry Vault",
    iconBg: "bg-orange-500/15 dark:bg-orange-400/15",
    iconColor: "text-orange-600 dark:text-orange-400",
    cardBorder: "border-warning/30 bg-gradient-to-br from-warning/10 to-muted",
    strategyDescription: "The vault targets growth in BTC per share. Deposited wBTC is used as collateral to borrow USDST, which is deployed into yield-bearing stablecoins (syrupUSDC, sUSDS). The net carry is periodically converted back into BTC, increasing each share's claim on BTC over time. The vault maintains an idle buffer for withdrawals; large redemptions may queue when capital is deployed.",
  },
  "usdc-yield": {
    title: "USDC Yield Vault",
    subtitle: "ERC-4626 yield vault for USDC deposits",
    badge: "Yield Vault",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-400/15",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    cardBorder: "border-success/25 bg-gradient-to-br from-success/10 to-muted",
    strategyDescription: "The vault targets growth in USDC per share by routing deposits across approved yield strategies. USDC may be converted into other tokens when needed to access yield, but the vault manages returns back to USDC-denominated value. Yield is harvested, rebalanced, and compounded over time. The vault maintains an idle buffer for withdrawals; large redemptions may queue when capital is deployed.",
  },
  "goldst-yield": {
    title: "GOLDST Yield Vault",
    subtitle: "Deposit GOLDST and earn Reward Points",
    badge: "Yield Vault",
    iconBg: "bg-amber-500/15 dark:bg-amber-400/15",
    iconColor: "text-amber-600 dark:text-amber-400",
    cardBorder: "border-gold/30 bg-gradient-to-br from-gold/10 to-muted",
    strategyDescription: "Deposits remain denominated in GOLDST. This vault does not use a funded Base APY; users earn Reward Points based on their vault-share position. The vault maintains an idle buffer for withdrawals, and redemptions may queue when idle liquidity is unavailable.",
  },
  "silvst-yield": {
    title: "SILVST Yield Vault",
    subtitle: "Deposit SILVST and earn Reward Points",
    badge: "Yield Vault",
    iconBg: "bg-slate-500/15 dark:bg-slate-400/15",
    iconColor: "text-slate-600 dark:text-slate-400",
    cardBorder: "border-slate-500/25 dark:border-slate-400/25 bg-gradient-to-br from-card to-muted",
    strategyDescription: "Deposits remain denominated in SILVST. This vault does not use a funded Base APY; users earn Reward Points based on their vault-share position. The vault maintains an idle buffer for withdrawals, and redemptions may queue when idle liquidity is unavailable.",
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
    return `${num.toFixed(6)} ${assetSymbol}`;
  } catch {
    return "-";
  }
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
  if (totalShares <= 0n) return shares;
  if (totalAssets <= 0n) return 0n;
  return (shares * totalAssets) / totalShares;
};

const previewSharesForAssets = (assets: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  if (assets <= 0n) return 0n;
  if (totalShares <= 0n) return assets;
  if (totalAssets <= 0n) return 0n;
  return (assets * totalShares) / totalAssets;
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
  const { tokenApys } = useEarnContext();
  const {
    activities: rewardsActivities,
    loading: rewardsActivitiesLoading,
    refetch: refetchRewardsActivities,
  } = useRewardsActivities();
  const {
    userRewards,
    loading: rewardsUserLoading,
    refetch: refetchUserRewards,
  } = useRewardsUserInfo();

  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [actionAmount, setActionAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<YieldVaultHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Redirect to earn page if vault key is unknown.
  useEffect(() => {
    if (!meta) navigate("/dashboard/earn", { replace: true });
  }, [meta, navigate]);

  const vaultInfo = getVaultInfo(vaultKey);
  const userInfo = getUserVaultInfo(vaultKey);
  const effectiveInfo = userInfo || vaultInfo;
  const isFundedVault = Boolean(effectiveInfo?.accrualInitialized);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get<YieldVaultHistoryPoint[]>(
        `/earn/yield-vault/${vaultKey}/history`
      );
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [vaultKey]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const loadHistory = useCallback(async () => {
    if (!isFundedVault) {
      setHistory([]);
      return;
    }
    await fetchHistory();
  }, [fetchHistory, isFundedVault]);

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
  const displayedExchangeRate =
    isFundedVault
      ? effectiveInfo?.projectedExchangeRate || effectiveInfo?.exchangeRate || "0"
      : effectiveInfo?.exchangeRate || "0";
  const displayedTvlUsd =
    isFundedVault
      ? effectiveInfo?.projectedTvlUsd || effectiveInfo?.tvlUsd || "0"
      : effectiveInfo?.tvlUsd || "0";
  const exchangeRate = formatExchangeRate(displayedExchangeRate, assetSymbol);
  const tvlDisplay = loadingVaults ? "..." : formatUsdAmount(displayedTvlUsd);
  const bestApyInfo = useMemo(
    () => findBestEarnApyInfo(tokenApys, effectiveInfo?.vaultAddress),
    [effectiveInfo?.vaultAddress, tokenApys]
  );
  const bestApyDisplay = (() => {
    if (loadingVaults) return { label: "...", className: "text-foreground" };
    const rawTotal = bestApyInfo?.total;
    if (!isDeployed || !rawTotal || !Number.isFinite(rawTotal) || rawTotal <= 0) {
      return { label: "—", className: "text-muted-foreground" };
    }
    return { label: `+${rawTotal.toFixed(2)}%`, className: "text-foreground" };
  })();
  const userShares = userInfo?.userShares || "0";
  const redeemableAssets =
    isFundedVault
      ? userInfo?.projectedRedeemableAssets || userInfo?.redeemableAssets || "0"
      : userInfo?.redeemableAssets || "0";
  const positionUsdWad =
    isFundedVault
      ? userInfo?.projectedPositionUsd || userInfo?.positionUsd || "0"
      : userInfo?.positionUsd || "0";
  const walletAssets = userInfo?.walletAssets || "0";
  const maxRedeemShares = userInfo?.maxRedeem || "0";
  const maxWithdrawAssets = userInfo?.maxWithdraw || "0";
  const claimableAssets = userInfo?.claimableAssets || "0";
  const pendingWithdrawal = userInfo?.pendingWithdrawal || null;
  const hasPendingWithdrawal = Boolean(pendingWithdrawal);
  const hasClaimableAssets = BigInt(claimableAssets || "0") > 0n;
  const strategyHoldings = effectiveInfo?.strategyHoldings || [];

  const decimals = effectiveInfo?.decimals ?? 18;

  const normalizedVaultAddress = effectiveInfo?.vaultAddress?.toLowerCase?.() || "";
  // Strict match by on-chain sourceContract. If the Rewards activity isn't
  // pointing at this vault address, no rewards UI renders for this page.
  const matchesCarryActivity = (source: string | undefined): boolean => {
    if (!normalizedVaultAddress) return false;
    return (source || "").toLowerCase() === normalizedVaultAddress;
  };
  const carryRewardsActivity = useMemo(() => {
    return (
      rewardsActivities.find((activity) =>
        matchesCarryActivity(activity.sourceContract)
      ) || null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedVaultAddress, rewardsActivities]);
  const carryRewardEntries = useMemo(() => {
    return (
      userRewards?.activities.filter(({ activity }) =>
        matchesCarryActivity(activity.sourceContract)
      ) || []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedVaultAddress, userRewards]);
  const carryRewardPointsPerDollarPerDay = useMemo(() => {
    try {
      const emissionRate = carryRewardsActivity?.emissionRate;
      const totalStakeUsd =
        carryRewardsActivity?.totalStakeUsd ?? effectiveInfo?.tvlUsd ?? null;
      if (!emissionRate || !totalStakeUsd) return null;
      const totalStakeUsdBig = BigInt(totalStakeUsd);
      if (totalStakeUsdBig <= 0n) return null;
      const ptsPerDollarPerDayWei =
        (BigInt(emissionRate) * 86400n * 10n ** 18n) / totalStakeUsdBig;
      const decimal = formatUnits(ptsPerDollarPerDayWei, 18);
      return formatRoundedWithCommas(roundByMagnitude(decimal));
    } catch {
      return null;
    }
  }, [carryRewardsActivity?.emissionRate, carryRewardsActivity?.totalStakeUsd, effectiveInfo?.tvlUsd]);
  const carryRewardPointsPerDay = useMemo(() => {
    if (carryRewardEntries.length === 0) return "0";
    const rewardsPerDay = carryRewardEntries.reduce(
      (total, { activity, userInfo: rewardUserInfo, personalEmissionRate }) => {
        if (personalEmissionRate && BigInt(personalEmissionRate) > 0n) {
          return total + BigInt(personalEmissionRate) * 86400n;
        }
        return (
          total +
          BigInt(
            calculateEstimatedRewardsPerDay(
              rewardUserInfo?.stake || "0",
              activity.totalStake || "0",
              activity.emissionRate || "0"
            )
          )
        );
      },
      0n
    );
    return formatRoundedWithCommas(roundByMagnitude(formatUnits(rewardsPerDay, 18)));
  }, [carryRewardEntries]);

  const depositDisabled = !isLoggedIn || !isDeployed;
  const redeemDisabled = !isLoggedIn || !isDeployed || hasPendingWithdrawal;

  const amountWei = actionAmount ? safeParseUnits(actionAmount, decimals) : 0n;
  const actionMaxWei = useMemo(() => {
    if (actionMode === "deposit") return BigInt(userInfo?.maxDeposit || "0");
    if (actionMode === "redeem") return BigInt(userInfo?.userShares || "0");
    return 0n;
  }, [actionMode, userInfo?.maxDeposit, userInfo?.userShares]);

  const totalAssetsBig = BigInt(effectiveInfo?.totalAssets || "0");
  const totalClaimableAssetsBig = BigInt(effectiveInfo?.totalClaimableAssets || "0");
  const activeAssetsBig =
    totalAssetsBig > totalClaimableAssetsBig ? totalAssetsBig - totalClaimableAssetsBig : 0n;
  const depositPricingAssetsBig =
    isFundedVault
      ? BigInt(effectiveInfo?.projectedActiveAssets || activeAssetsBig.toString())
      : activeAssetsBig;
  const totalSharesBig = BigInt(effectiveInfo?.totalShares || "0");

  const previewValueWei = useMemo(() => {
    if (amountWei <= 0n) return 0n;

    if (actionMode === "deposit") {
      return previewSharesForAssets(amountWei, depositPricingAssetsBig, totalSharesBig);
    }
    if (actionMode === "redeem") {
      return previewAssetsForShares(amountWei, activeAssetsBig, totalSharesBig);
    }
    return 0n;
  }, [actionMode, amountWei, activeAssetsBig, depositPricingAssetsBig, totalSharesBig]);

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
    () => previewAssetsForShares(instantWithdrawSharesWei, activeAssetsBig, totalSharesBig),
    [instantWithdrawSharesWei, activeAssetsBig, totalSharesBig]
  );

  const queuedWithdrawAssetsEstimateWei = useMemo(
    () => previewAssetsForShares(queuedWithdrawSharesWei, activeAssetsBig, totalSharesBig),
    [queuedWithdrawSharesWei, activeAssetsBig, totalSharesBig]
  );

  const isActionAmountValid = amountWei > 0n && amountWei <= actionMaxWei;

  // Refresh vault + rewards state after any user action. The rewards poller
  // is an off-chain indexer, so we schedule a delayed second pass to give it
  // a window to ingest the Deposit/Withdraw event before we read stake.
  const REWARDS_POLLER_DELAY_MS = 10000;
  const refreshAfterAction = async () => {
    await Promise.allSettled([
      refreshVaults(),
      refetchRewardsActivities(),
      refetchUserRewards(),
      loadHistory(),
    ]);
    window.setTimeout(() => {
      Promise.allSettled([refetchRewardsActivities(), refetchUserRewards()]).catch(
        () => undefined
      );
    }, REWARDS_POLLER_DELAY_MS);
  };

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
      await refreshAfterAction();
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
      await refreshAfterAction();
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
      await refreshAfterAction();
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
          className="transition-[padding-left] duration-300 md:pl-64"
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

  const positionValueDisplay = loadingVaults
    ? "..."
    : isLoggedIn
      ? (() => {
          const sharesBn = BigInt(userShares || "0");
          const priceBn = BigInt(userInfo?.assetPriceWad || "0");
          if (sharesBn <= 0n) return "--";
          if (priceBn <= 0n && BigInt(positionUsdWad || "0") <= 0n) return "--";
          return formatUsdAmount(positionUsdWad);
        })()
      : "--";
  const rewardPointsDisplay =
    loadingVaults || rewardsActivitiesLoading || rewardsUserLoading
      ? "..."
      : isLoggedIn
        ? `${carryRewardPointsPerDay} points/day`
        : "--";

  const metrics = [
    {
      label: `${assetSymbol} balance`,
      value: loadingVaults ? "..." : isLoggedIn ? formatTokenAmount(walletAssets, decimals) : "--",
      hint: "Available to deposit",
      icon: <Wallet className="h-4 w-4 text-primary" />,
    },
    {
      label: `Your ${shareSymbol}`,
      value: loadingVaults ? "..." : isLoggedIn ? formatTokenAmount(userShares, decimals) : "--",
      hint: "Vault shares held",
      icon: <TrendingUp className={`h-4 w-4 ${meta.iconColor}`} />,
    },
    {
      label: "Position Value",
      value:
        positionValueDisplay === "--" || positionValueDisplay === "..."
          ? positionValueDisplay
          : `${positionValueDisplay} (${formatTokenAmount(redeemableAssets, decimals)} ${assetSymbol})`,
      hint: "NAV: share claim × exchange ratio × oracle price",
      icon: <CircleDollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />,
    },
    {
      label: "Reward Points / day",
      value:
        loadingVaults || rewardsActivitiesLoading || rewardsUserLoading
          ? "..."
          : isLoggedIn
            ? `${carryRewardPointsPerDay} points`
            : "--",
      hint: carryRewardPointsPerDollarPerDay
        ? `Points you can earn per day at the current rate (${carryRewardPointsPerDollarPerDay} pts/$1/day)`
        : "Reward Points you can earn per day at the current rate",
      icon: <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-[padding-left] duration-300 md:pl-64"
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
                      {meta.badge}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {assetSymbol}
                    </Badge>
                    {!isDeployed && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Not deployed
                      </Badge>
                    )}
                  </div>

                  <Card className={`border ${meta?.cardBorder ?? ""}`}>
                    <CardContent className={isFundedVault ? "p-4 md:p-5" : "pt-5 space-y-5"}>
                      {isFundedVault ? (
                        <div className="space-y-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 rounded-full ${meta.iconBg} flex items-center justify-center`}
                              >
                                <TrendingUp className={`h-4 w-4 ${meta.iconColor}`} />
                              </div>
                              <div>
                                <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                                  {meta.title}
                                </h1>
                                <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:min-w-[300px]">
                              <Button
                                className="h-9"
                                onClick={() => handleActionRequest("deposit")}
                                disabled={depositDisabled}
                              >
                                Deposit {assetSymbol}
                              </Button>
                              <Button
                                variant="outline"
                                className="h-9"
                                onClick={() => handleActionRequest("redeem")}
                                disabled={redeemDisabled}
                              >
                                Withdraw
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                            <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                              <p className="text-muted-foreground">Current price</p>
                              <p className="mt-1 text-base font-semibold tabular-nums">{exchangeRate}</p>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                              <p className="text-muted-foreground">TVL</p>
                              <p className="mt-1 text-base font-semibold tabular-nums">{tvlDisplay}</p>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                              <p className="inline-flex items-center gap-1 text-muted-foreground">
                                Best available APY
                                <BestApyInfoTooltip />
                              </p>
                              {loadingVaults || rewardsActivitiesLoading ? (
                                <p className="mt-1 text-base font-semibold tabular-nums">...</p>
                              ) : (
                                <EarnApyTooltip info={bestApyInfo}>
                                  <p className={`mt-1 text-base font-semibold tabular-nums cursor-default ${bestApyDisplay.className}`}>
                                    {bestApyDisplay.label}
                                  </p>
                                </EarnApyTooltip>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Your position</p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                                <p className="text-xs text-muted-foreground">Position value</p>
                                <p className="mt-1 text-base font-semibold tabular-nums">{positionValueDisplay}</p>
                              </div>
                              <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                                <p className="text-xs text-muted-foreground">Redeemable</p>
                                <p className="mt-1 text-base font-semibold tabular-nums">
                                  {isLoggedIn ? formatTokenAmount(redeemableAssets, decimals) : "--"}{" "}
                                  {isLoggedIn ? assetSymbol : ""}
                                </p>
                              </div>
                              <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                                <p className="text-xs text-muted-foreground">Your {shareSymbol}</p>
                                <p className="mt-1 text-base font-semibold tabular-nums">
                                  {isLoggedIn ? formatTokenAmount(userShares, decimals) : "--"}
                                </p>
                              </div>
                              <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  Reward Points / day
                                  <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                </p>
                                <p className="mt-1 text-base font-semibold tabular-nums">{rewardPointsDisplay}</p>
                              </div>
                            </div>
                          </div>

                          {(hasPendingWithdrawal || hasClaimableAssets) && (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {hasClaimableAssets && (
                                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/70 p-2.5 text-xs">
                                  <div>
                                    <p className="text-muted-foreground">Ready to claim</p>
                                    <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                                      {formatTokenAmount(claimableAssets, decimals)} {assetSymbol}
                                    </p>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isSubmitting}
                                    onClick={handleClaim}
                                  >
                                    Claim
                                  </Button>
                                </div>
                              )}
                              {hasPendingWithdrawal && (
                                <div className="rounded-lg border border-border/60 bg-background/70 p-2.5 text-xs">
                                  <p className="text-muted-foreground">Queued withdrawal</p>
                                  <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
                                    {formatTokenAmount(pendingWithdrawal?.shares || "0", decimals)} {shareSymbol}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                          {!isDeployed && (
                            <p className="text-xs text-muted-foreground">
                              This vault is not deployed on this network yet.
                            </p>
                          )}
                        </div>
                      ) : (
                        <>
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
                              <p className="text-muted-foreground">Exchange rate</p>
                              <p className="mt-1 text-lg font-semibold tabular-nums">{exchangeRate}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {assetSymbol} redeemable per {shareSymbol}
                              </p>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                              <p className="text-muted-foreground">TVL</p>
                              <p className="mt-1 text-lg font-semibold tabular-nums">{tvlDisplay}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Total value locked in the vault
                              </p>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                              <p className="text-muted-foreground inline-flex items-center gap-1">
                                Best available APY
                                <BestApyInfoTooltip />
                              </p>
                              {loadingVaults || rewardsActivitiesLoading ? (
                                <p className="mt-1 text-lg font-semibold tabular-nums">...</p>
                              ) : (
                                <EarnApyTooltip info={bestApyInfo}>
                                  <p className={`mt-1 text-lg font-semibold tabular-nums cursor-default ${bestApyDisplay.className}`}>
                                    {bestApyDisplay.label}
                                  </p>
                                </EarnApyTooltip>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">
                                Estimated annualized total yield, including rewards and native fees
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
                        </>
                      )}
                    </CardContent>
                  </Card>
                </section>

                {!isFundedVault && (
                  <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {metrics.map((metric) => (
                      <Card key={metric.label} className="border border-border/70">
                        <CardContent className="pt-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">{metric.label}</p>
                            {metric.icon}
                          </div>
                          <p className="text-2xl font-semibold leading-none tabular-nums">{metric.value}</p>
                          <p className="text-xs text-muted-foreground">{metric.hint}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </section>
                )}

                {isFundedVault && (
                  <YieldVaultHistoryCharts
                    history={history}
                    currentExchangeRate={displayedExchangeRate}
                    currentTvlUsd={displayedTvlUsd}
                    assetSymbol={assetSymbol}
                    loading={historyLoading}
                  />
                )}

                {!isFundedVault && (
                  <section className="space-y-3">
                    <h2 className="text-xl font-semibold">Vault parameters</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Vault address</p>
                        <div className="flex items-center gap-1">
                          <p className="font-mono text-sm font-semibold break-all">{formatAddress(effectiveInfo?.vaultAddress || "")}</p>
                          <CopyButton address={effectiveInfo?.vaultAddress || ""} />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Idle assets</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatTokenAmount(effectiveInfo?.idleAssets || "0", decimals)} {assetSymbol}
                        </p>
                        <p className="text-xs text-muted-foreground">Currently available inside the vault</p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Deployed assets</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {formatTokenAmount(effectiveInfo?.deployedAssets || "0", decimals)} {assetSymbol}
                        </p>
                        <p className="text-xs text-muted-foreground">Capital deployed to the strategy</p>
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Min idle reserve</p>
                        <p className="text-lg font-semibold tabular-nums">{formatBps(effectiveInfo?.minIdleBps || "0")}</p>
                        <p className="text-xs text-muted-foreground">
                          Queue: {BigInt(effectiveInfo?.totalQueuedShares || "0") > 0n ? "open" : "clear"}
                        </p>
                      </CardContent>
                    </Card>
                    </div>
                  </section>
                )}

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">
                    {isFundedVault ? "How this vault earns" : "Strategy"}
                  </h2>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                    {meta?.strategyDescription}
                  </p>
                </section>

                <section className="space-y-3">
                  <details
                    key={isFundedVault ? "funded-strategy" : "standard-strategy"}
                    defaultOpen={!isFundedVault}
                    className={isFundedVault ? "group rounded-lg border border-border/70 bg-card" : ""}
                  >
                    <summary
                      className={
                        isFundedVault
                          ? "flex cursor-pointer list-none items-center justify-between p-4 text-xl font-semibold"
                          : "hidden"
                      }
                    >
                      Vault &amp; strategy details
                      <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className={isFundedVault ? "space-y-3 border-t border-border/70 p-4" : "space-y-3"}>
                  {isFundedVault && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-border/60 pb-4 text-sm lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Vault address</p>
                        <div className="mt-1 flex items-center gap-1">
                          <p className="font-mono font-medium">{formatAddress(effectiveInfo?.vaultAddress || "")}</p>
                          <CopyButton address={effectiveInfo?.vaultAddress || ""} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Idle assets</p>
                        <p className="mt-1 font-medium tabular-nums">
                          {formatTokenAmount(effectiveInfo?.idleAssets || "0", decimals)} {assetSymbol}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Deployed assets</p>
                        <p className="mt-1 font-medium tabular-nums">
                          {formatTokenAmount(effectiveInfo?.deployedAssets || "0", decimals)} {assetSymbol}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Reserve / queue</p>
                        <p className="mt-1 font-medium tabular-nums">
                          {formatBps(effectiveInfo?.minIdleBps || "0")} ·{" "}
                          {BigInt(effectiveInfo?.totalQueuedShares || "0") > 0n ? "Open" : "Clear"}
                        </p>
                      </div>
                    </div>
                  )}
                  <h2 className={isFundedVault ? "sr-only" : "text-xl font-semibold"}>Strategy holdings</h2>
                  {strategyHoldings.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3">
                      {strategyHoldings.map((holding) => (
                        <Card key={holding.strategyAddress} className="border border-border/70">
                          <CardContent className="pt-4 space-y-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Strategy address</p>
                                <div className="flex items-center gap-1">
                                  <p className="font-mono text-sm font-medium break-all">{formatAddress(holding.strategyAddress)}</p>
                                  <CopyButton address={holding.strategyAddress} />
                                </div>
                              </div>
                              <div className="space-y-1 sm:text-right">
                                <p className="text-xs text-muted-foreground">Deployed capital</p>
                                <p className="text-lg font-semibold tabular-nums">
                                  {formatTokenAmount(holding.deployedAssets, decimals)} {assetSymbol}
                                </p>
                              </div>
                              <div className="space-y-1 sm:text-right">
                                <p className="text-xs text-muted-foreground">Base APY</p>
                                {(() => {
                                  const apy = holding.baseApyPct;
                                  if (apy === null || apy === undefined || !Number.isFinite(apy)) {
                                    return (
                                      <p className="text-lg font-semibold text-muted-foreground">—</p>
                                    );
                                  }
                                  const sign = apy > 0 ? "+" : apy < 0 ? "" : "";
                                  const tone =
                                    apy > 0
                                      ? "text-success"
                                      : apy < 0
                                        ? "text-destructive"
                                        : "text-foreground";
                                  return (
                                    <p className={`text-lg font-semibold tabular-nums ${tone}`}>
                                      {`${sign}${apy.toFixed(2)}%`}
                                    </p>
                                  );
                                })()}
                                <p className="text-[11px] text-muted-foreground">
                                  Forward yield in {assetSymbol}
                                </p>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground uppercase tracking-wide">Composition</p>
                              {holding.composition && holding.composition.length > 0 ? (
                                <div className="rounded-md border border-border/60 divide-y divide-border/60">
                                  {holding.composition.map((asset) => (
                                    <div
                                      key={asset.tokenAddress}
                                      className="flex items-center justify-between px-3 py-2 text-sm"
                                    >
                                      <span className="font-medium text-foreground tabular-nums">
                                        {asset.tokenSymbol || formatAddress(asset.tokenAddress)}
                                      </span>
                                      <span className="font-mono tabular-nums text-foreground">
                                        {formatTokenAmount(asset.amount, asset.decimals)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No assets detected for this strategy.
                                </p>
                              )}
                              <p className="text-[11px] text-muted-foreground">
                                Total assets controlled by this strategy. Includes ERC-20 wallet balances and collateral locked in CDP.
                              </p>
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground uppercase tracking-wide">USDST debt</p>
                              <div className="rounded-md border border-border/60 px-3 py-2 text-sm flex items-center justify-between">
                                <span className="font-medium text-foreground tabular-nums">USDST</span>
                                <span className="font-mono tabular-nums text-foreground">
                                  {formatTokenAmount(holding.usdstDebt || "0", 18)}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                Total USDST borrowed by this strategy across all CDP positions, accrued at the latest indexed rate.
                              </p>
                            </div>

                            {(() => {
                              const offChainUsd = Number(formatUnits(holding.offChainUsdWad || "0", 18));
                              if (!Number.isFinite(offChainUsd) || offChainUsd < OFF_CHAIN_DISPLAY_FLOOR_USD) {
                                return null;
                              }
                              const outflows = holding.recentOutflows || [];
                              return (
                                <div className="space-y-2">
                                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Off-chain capital</p>
                                  <div className="rounded-md border border-border/60 px-3 py-2 text-sm flex items-center justify-between">
                                    <span className="font-medium text-foreground tabular-nums">In transit</span>
                                    <span className="font-mono tabular-nums text-foreground">
                                      ~{formatUsdAmount(holding.offChainUsdWad || "0")}
                                    </span>
                                  </div>
                                  {outflows.length > 0 && (
                                    <div className="rounded-md border border-border/60 divide-y divide-border/60">
                                      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                                        Recent bridge-outs
                                      </div>
                                      {outflows.map((outflow, idx) => (
                                        <div
                                          key={`${outflow.tokenAddress}-${outflow.timestampMs}-${idx}`}
                                          className="flex items-center justify-between px-3 py-2 text-sm"
                                        >
                                          <span className="font-medium text-foreground tabular-nums">
                                            {outflow.tokenSymbol || formatAddress(outflow.tokenAddress)}
                                          </span>
                                          <div className="flex flex-col items-end">
                                            <span className="font-mono tabular-nums text-foreground">
                                              {formatTokenAmount(outflow.amount, outflow.decimals)}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">
                                              {outflow.timestampMs > 0
                                                ? `bridged ${formatDistanceToNow(outflow.timestampMs, { addSuffix: true })}`
                                                : "bridged recently"}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                </div>
                              );
                            })()}
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
                    </div>
                  </details>
                </section>

                {!isFundedVault && (
                  <section className="space-y-3">
                    <h2 className="text-xl font-semibold">Withdrawal status</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Card className="border border-border/70">
                      <CardContent className="pt-4 space-y-2">
                        <p className="text-xs text-muted-foreground">Withdrawable instantly</p>
                        <p className="text-2xl font-semibold tabular-nums">
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
                        <p className="text-xs text-muted-foreground">Estimated pending claim</p>
                        <p className="text-2xl font-semibold tabular-nums">
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
                          <p className="text-xs text-muted-foreground">Claimable now</p>
                          <p className="text-2xl font-semibold tabular-nums">
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
                )}

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
                  className="font-medium text-primary hover:text-primary/80 tabular-nums"
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
                <span>{assetSymbol} balance</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatTokenAmount(walletAssets, decimals)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{shareSymbol} balance</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatTokenAmount(userShares, decimals)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>You receive</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatTokenAmount(previewValueWei.toString(), decimals)} {actionPreviewSymbol}
                </span>
              </div>
            </div>
            {actionMode === "redeem" && (
              <div className="rounded-lg border border-border/70 bg-background/60 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span>Withdrawable instantly</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatTokenAmount(instantWithdrawAssetsWei.toString(), decimals)} {assetSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Estimated queued</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {formatTokenAmount(queuedWithdrawAssetsEstimateWei.toString(), decimals)} {assetSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total position claim</span>
                  <span className="font-medium text-foreground tabular-nums">
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
            {carryRewardsActivity?.name && !rewardsUserLoading && (
              <RewardsWidget
                userRewards={userRewards}
                activityName={carryRewardsActivity.name}
                inputAmount={actionAmount}
                isWithdrawal={actionMode === "redeem"}
                actionLabel={actionMode === "redeem" ? "Withdraw" : "Deposit"}
              />
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
                  Withdraw all
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
