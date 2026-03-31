import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft, CircleDollarSign, PiggyBank, Sparkles, Wallet } from "lucide-react";
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
import { useUser } from "@/context/UserContext";
import { useSaveUsdstContext } from "@/context/SaveUsdstContext";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import { safeParseUnits } from "@/utils/numberUtils";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import StackedApyTooltip from "@/components/ui/StackedApyTooltip";
import {
  calculateEstimatedRewardsPerDay,
  formatRoundedWithCommas,
  roundByMagnitude,
} from "@/services/rewardsService";
import { buildStackedApyBreakdown, calculateRewardApy } from "@/lib/stackedApy";

const CATA_PRICE_USD = 0.25;

const formatTokenAmount = (value: string, maxFractionDigits: number = 4): string => {
  try {
    const num = Number(formatUnits(value || "0", 18));
    if (!Number.isFinite(num) || Math.abs(num) < 0.000001) return "0";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
  } catch {
    return "0";
  }
};

const formatExchangeRate = (exchangeRate: string): string => {
  try {
    const num = Number(formatUnits(exchangeRate || "0", 18));
    if (!Number.isFinite(num)) return "-";
    return `${num.toFixed(4)} USDST`;
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

type ActionMode = "deposit" | "redeem" | null;

const getEstimatedIncentiveApyPercent = (
  nativeApyPercent?: string | number | null,
  emissionRate?: string,
  totalStakeUsd?: string | null
): string => {
  try {
    if (!emissionRate || !totalStakeUsd) return "-";

    const nativeApy =
      nativeApyPercent === null ||
      nativeApyPercent === undefined ||
      nativeApyPercent === "" ||
      nativeApyPercent === "-"
        ? 0
        : Number(nativeApyPercent);
    if (!Number.isFinite(nativeApy)) {
      return "-";
    }

    const tvlUsd = Number(BigInt(totalStakeUsd)) / 1e18;
    if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return "-";

    const annualCata = (Number(BigInt(emissionRate)) / 1e18) * 86400 * 365;
    if (!Number.isFinite(annualCata) || annualCata < 0) return "-";

    const rewardsApy = ((annualCata * CATA_PRICE_USD) / tvlUsd) * 100;
    const totalApy = nativeApy + rewardsApy;
    if (!Number.isFinite(totalApy) || totalApy <= 0) {
      return "-";
    }

    return totalApy.toFixed(2);
  } catch {
    return "-";
  }
};

const getPointsPerDollarPerDay = (
  emissionRate?: string,
  totalStakeUsd?: string | null
): string | null => {
  try {
    if (!emissionRate || !totalStakeUsd) return null;
    const totalStakeUsdBig = BigInt(totalStakeUsd);
    if (totalStakeUsdBig <= 0n) return null;

    const ptsPerDollarPerDayWei = (BigInt(emissionRate) * 86400n * (10n ** 18n)) / totalStakeUsdBig;
    return formatRoundedWithCommas(
      roundByMagnitude(formatTokenAmount(ptsPerDollarPerDayWei.toString(), 18))
    );
  } catch {
    return null;
  }
};

const EarnSave = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const { activities: rewardsActivities, loading: rewardsActivitiesLoading } = useRewardsActivities();
  const { userRewards, loading: rewardsUserLoading } = useRewardsUserInfo();
  const {
    saveUsdstInfo: saveInfo,
    saveUsdstUserInfo: userInfo,
    loadingSaveUsdst: loadingInfo,
    refreshSaveUsdst,
  } = useSaveUsdstContext();
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [actionAmount, setActionAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Save USDST | STRATO";
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!actionMode) {
      setActionAmount("");
    }
  }, [actionMode]);

  const effectiveInfo = userInfo || saveInfo;
  const exchangeRate = formatExchangeRate(effectiveInfo?.exchangeRate || "0");
  const tvlDisplay = loadingInfo
    ? "..."
    : formatUsdAmount(effectiveInfo?.tvlUsd || "0");
  const walletAssets = userInfo?.walletAssets || "0";
  const userShares = userInfo?.userShares || "0";
  const redeemableAssets = userInfo?.redeemableAssets || "0";
  const isConfigured = Boolean(effectiveInfo?.configured);
  const isDeployed = Boolean(effectiveInfo?.deployed);
  const isPaused = Boolean(effectiveInfo?.paused);
  const normalizedVaultAddress = effectiveInfo?.vaultAddress?.toLowerCase?.() || "";
  const saveRewardsActivity = useMemo(() => {
    return rewardsActivities.find((activity) => {
      const source = activity.sourceContract?.toLowerCase?.() || "";
      const name = activity.name?.toLowerCase?.() || "";

      if (normalizedVaultAddress && source === normalizedVaultAddress) {
        return true;
      }

      return name.includes("save usdst") || name.includes("saveusdst");
    }) || null;
  }, [normalizedVaultAddress, rewardsActivities]);
  const saveRewardEntries = useMemo(() => {
    return userRewards?.activities.filter(({ activity }) => {
      const source = activity.sourceContract?.toLowerCase?.() || "";
      const name = activity.name?.toLowerCase?.() || "";

      if (normalizedVaultAddress && source === normalizedVaultAddress) {
        return true;
      }

      return name.includes("save usdst") || name.includes("saveusdst");
    }) || [];
  }, [normalizedVaultAddress, userRewards]);
  const incentiveYield = formatPercent(
    getEstimatedIncentiveApyPercent(
      effectiveInfo?.apy,
      saveRewardsActivity?.emissionRate,
      saveRewardsActivity?.totalStakeUsd ??
        effectiveInfo?.tvlUsd ??
        effectiveInfo?.pricingAssets ??
        effectiveInfo?.totalAssets ??
        null
    )
  );
  const saveYieldBreakdown = useMemo(
    () =>
      buildStackedApyBreakdown({
        native: effectiveInfo?.apy,
        reward: calculateRewardApy(
          saveRewardsActivity?.emissionRate,
          saveRewardsActivity?.totalStakeUsd ??
            effectiveInfo?.tvlUsd ??
            effectiveInfo?.pricingAssets ??
            effectiveInfo?.totalAssets ??
            null,
        ),
      }),
    [
      effectiveInfo?.apy,
      effectiveInfo?.pricingAssets,
      effectiveInfo?.totalAssets,
      effectiveInfo?.tvlUsd,
      saveRewardsActivity?.emissionRate,
      saveRewardsActivity?.totalStakeUsd,
    ],
  );
  const saveRewardPointsPerDollarPerDay = useMemo(
    () =>
      getPointsPerDollarPerDay(
        saveRewardsActivity?.emissionRate,
        saveRewardsActivity?.totalStakeUsd ??
          effectiveInfo?.tvlUsd ??
          effectiveInfo?.pricingAssets ??
          effectiveInfo?.totalAssets ??
          null
      ),
    [
      saveRewardsActivity?.emissionRate,
      saveRewardsActivity?.totalStakeUsd,
      effectiveInfo?.tvlUsd,
      effectiveInfo?.pricingAssets,
      effectiveInfo?.totalAssets,
    ]
  );
  const saveRewardPointsPerDay = useMemo(() => {
    if (saveRewardEntries.length === 0) return "0";

    const rewardsPerDay = saveRewardEntries.reduce((total, { activity, userInfo, personalEmissionRate }) => {
      if (personalEmissionRate && BigInt(personalEmissionRate) > 0n) {
        return total + (BigInt(personalEmissionRate) * 86400n);
      }

      return total + BigInt(calculateEstimatedRewardsPerDay(
        userInfo?.stake || "0",
        activity.totalStake || "0",
        activity.emissionRate || "0"
      ));
    }, 0n);

    return formatRoundedWithCommas(roundByMagnitude(formatUnits(rewardsPerDay, 18)));
  }, [saveRewardEntries]);
  const isInsolvent = BigInt(effectiveInfo?.totalShares || "0") > 0n && BigInt(effectiveInfo?.pricingAssets || "0") === 0n;
  const depositDisabled = !isLoggedIn || !isConfigured || !isDeployed || isPaused || isInsolvent;
  const redeemDisabled = !isLoggedIn || !isConfigured || !isDeployed || isPaused;

  const amountWei = actionAmount ? safeParseUnits(actionAmount, 18) : 0n;
  const actionMaxWei = useMemo(() => {
    if (actionMode === "deposit") return BigInt(userInfo?.maxDeposit || "0");
    if (actionMode === "redeem") return BigInt(userInfo?.maxRedeem || "0");
    return 0n;
  }, [actionMode, userInfo?.maxDeposit, userInfo?.maxRedeem]);

  const previewValueWei = useMemo(() => {
    const pricingAssets = BigInt(effectiveInfo?.pricingAssets || "0");
    const totalShares = BigInt(effectiveInfo?.totalShares || "0");

    if (amountWei <= 0n) return 0n;

    if (actionMode === "deposit") {
      if (pricingAssets <= 0n || totalShares <= 0n) return amountWei;
      return (amountWei * totalShares) / pricingAssets;
    }

    if (actionMode === "redeem") {
      if (pricingAssets <= 0n || totalShares <= 0n) return 0n;
      return (amountWei * pricingAssets) / totalShares;
    }

    return 0n;
  }, [actionMode, amountWei, effectiveInfo?.pricingAssets, effectiveInfo?.totalShares]);

  const isActionAmountValid = amountWei > 0n && amountWei <= actionMaxWei;

  const metrics = [
    {
      label: "USDST Balance",
      value: loadingInfo ? "..." : isLoggedIn ? formatTokenAmount(walletAssets) : "--",
      hint: "Available to save",
      icon: <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
    },
    {
      label: "Your saveUSDST",
      value: loadingInfo ? "..." : isLoggedIn ? formatTokenAmount(userShares) : "--",
      hint: "Savings shares held",
      icon: <PiggyBank className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      label: "Position Value",
      value: loadingInfo ? "..." : isLoggedIn ? `${formatTokenAmount(redeemableAssets)} USDST` : "--",
      hint: "Current redeemable value",
      icon: <CircleDollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />,
    },
    {
      label: "Estimated Rewards/Day",
      value: loadingInfo || rewardsUserLoading ? "..." : isLoggedIn ? `${saveRewardPointsPerDay} points` : "--",
      hint: saveRewardPointsPerDollarPerDay
        ? `Points you can earn per day at the current rate (${saveRewardPointsPerDollarPerDay} pts/$1/day)`
        : "Points you can earn per day at the current rate",
      icon: <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    },
  ];

  const handleActionRequest = (mode: Exclude<ActionMode, null>) => {
    if (!isLoggedIn) {
      toast({
        title: "Sign in required",
        description: "Connect your account to deposit or redeem saveUSDST.",
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
        await api.post("/earn/save-usdst/deposit", { amount: amountWei.toString() });
        toast({
          title: "Deposit submitted",
          description: `Depositing ${actionAmount} USDST into saveUSDST.`,
          variant: "success",
        });
      } else {
        await api.post("/earn/save-usdst/redeem", { sharesAmount: amountWei.toString() });
        toast({
          title: "Redeem submitted",
          description: `Redeeming ${actionAmount} saveUSDST back to USDST.`,
          variant: "success",
        });
      }

      setActionMode(null);
      await refreshSaveUsdst();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRedeemAll = async () => {
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      await api.post("/earn/save-usdst/redeem-all");
      toast({
        title: "Redeem submitted",
        description: "Redeeming your full saveUSDST balance back to USDST.",
        variant: "success",
      });
      setActionMode(null);
      await refreshSaveUsdst();
    } finally {
      setIsSubmitting(false);
    }
  };

  const actionPrimaryLabel = actionMode === "deposit" ? "Deposit USDST" : "Redeem saveUSDST";
  const actionSecondaryLabel = actionMode === "deposit" ? "You receive" : "You receive";
  const actionPreviewSymbol = actionMode === "deposit"
    ? (effectiveInfo?.shareSymbol || "saveUSDST")
    : (effectiveInfo?.assetSymbol || "USDST");
  const actionMaxInputValue = actionMode === "deposit"
    ? formatUnits(userInfo?.maxDeposit || "0", 18)
    : formatUnits(userInfo?.maxRedeem || "0", 18);
  const actionMaxLabel = actionMode === "deposit"
    ? formatTokenAmount(userInfo?.maxDeposit || "0")
    : formatTokenAmount(userInfo?.maxRedeem || "0");
  const actionDisabledReason = !isConfigured
    ? "Set SAVE_USDST_VAULT to enable transactions."
    : !isDeployed
      ? "The saveUSDST vault is not deployed on this network yet."
      : isPaused
        ? "The saveUSDST vault is currently paused."
        : isInsolvent
          ? "New deposits are blocked while the vault is fully insolvent."
        : null;

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="Save USDST" />

        <main className="pb-16 md:pb-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to view your USDST and saveUSDST balances." />
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
                      Native Savings
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      USDST Only
                    </Badge>
                    {!isConfigured && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Needs Config
                      </Badge>
                    )}
                    {isConfigured && !isDeployed && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Not Deployed
                      </Badge>
                    )}
                    {isPaused && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Paused
                      </Badge>
                    )}
                  </div>

                  <Card className="border border-blue-500/25 dark:border-blue-400/25 bg-gradient-to-br from-[#f8fbff] to-[#edf3ff] dark:from-[#0f1a33] dark:to-[#111c3a]">
                    <CardContent className="pt-5 space-y-5">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center">
                            <PiggyBank className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <h1 className="text-2xl md:text-4xl font-semibold tracking-tight">Save USDST</h1>
                            <p className="text-sm md:text-base text-muted-foreground">
                              Simple USD savings, natively on STRATO. Stay liquid. Earn rewards.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-muted-foreground">Exchange Rate</p>
                          <p className="mt-1 text-lg font-semibold">{exchangeRate}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            USDST redeemable per saveUSDST
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-muted-foreground">TVL</p>
                          <p className="mt-1 text-lg font-semibold">{tvlDisplay}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Total value currently saved in the vault
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                          <p className="text-muted-foreground">Yield</p>
                          <div className="mt-1">
                            {loadingInfo || rewardsActivitiesLoading ? (
                              <p className="text-lg font-semibold">...</p>
                            ) : (
                              <StackedApyTooltip
                                breakdown={saveYieldBreakdown}
                                valueText={incentiveYield}
                                className="text-lg font-semibold"
                              />
                            )}
                          </div>
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
                          Deposit USDST
                        </Button>
                        <Button
                          variant="outline"
                          className="sm:min-w-[180px]"
                          onClick={() => handleActionRequest("redeem")}
                          disabled={redeemDisabled}
                        >
                          Redeem saveUSDST
                        </Button>
                      </div>
                      {actionDisabledReason && (
                        <p className="text-xs text-muted-foreground">{actionDisabledReason}</p>
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
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

              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <MobileBottomNav />

      <Dialog open={actionMode !== null} onOpenChange={(open) => (!open ? setActionMode(null) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{actionPrimaryLabel}</DialogTitle>
            <DialogDescription>
              {actionMode === "deposit"
                ? "Deposit USDST into the native savings vault and receive saveUSDST shares."
                : "Redeem saveUSDST shares back into the underlying USDST asset."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span>Available</span>
                <button
                  type="button"
                  className="font-medium text-foreground hover:underline"
                  onClick={() => setActionAmount(actionMaxInputValue === "0.0" || actionMaxInputValue === "0" ? "" : actionMaxInputValue)}
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
                <span>USDST Balance</span>
                <span className="font-medium text-foreground">{formatTokenAmount(walletAssets)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>saveUSDST Balance</span>
                <span className="font-medium text-foreground">{formatTokenAmount(userShares)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{actionSecondaryLabel}</span>
                <span className="font-medium text-foreground">
                  {formatTokenAmount(previewValueWei.toString())} {actionPreviewSymbol}
                </span>
              </div>
            </div>
            {actionMode === "redeem" && (
              <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs">
                Current redeemable value: {formatTokenAmount(redeemableAssets)} USDST
              </div>
            )}
            {saveRewardsActivity?.name && !rewardsUserLoading && (
              <RewardsWidget
                userRewards={userRewards}
                activityName={saveRewardsActivity.name}
                inputAmount={actionAmount}
                isWithdrawal={actionMode === "redeem"}
                actionLabel={actionMode === "redeem" ? "Redeem" : "Deposit"}
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
                  disabled={BigInt(userInfo?.maxRedeem || "0") <= 0n || isSubmitting}
                  onClick={handleRedeemAll}
                >
                  Redeem All
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EarnSave;
