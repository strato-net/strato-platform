import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft, CircleDollarSign, PiggyBank, Sparkles, Wallet } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { BestApyInfoTooltip } from "@/components/earn/BestApyInfoTooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUser } from "@/context/UserContext";
import { useEarnContext } from "@/context/EarnContext";
import { useSaveUsdstContext, type SaveUsdstHistoryPoint } from "@/context/SaveUsdstContext";
import { useTokenContext } from "@/context/TokenContext";
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
import { findBestEarnApyInfo } from "@/utils/earnUtils";

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

const formatPrice = (price: string): string => {
  try {
    const num = Number(formatUnits(price || "0", 18));
    if (!Number.isFinite(num)) return "-";
    return `${num.toFixed(6)} USDST`;
  } catch {
    return "-";
  }
};

const formatFullPrice = (price: string): string => {
  try {
    return `${formatUnits(price || "0", 18)} USDST`;
  } catch {
    return "-";
  }
};

const formatPriceNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(6)} USDST`;
};

const formatPerformance = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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

const formatUsdNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "$0.00";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatCompactUsdNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  });
};

const formatApyDisplay = (value: string | number | undefined): { label: string; className: string } => {
  if (!value || value === "-") {
    return { label: "--", className: "text-foreground" };
  }

  const apy = Number(value);
  if (!Number.isFinite(apy)) {
    return { label: "--", className: "text-foreground" };
  }

  if (apy > 0) {
    return {
      label: `+${apy.toFixed(2)}%`,
      className: "text-foreground",
    };
  }

  if (apy < 0) {
    return {
      label: `${apy.toFixed(2)}%`,
      className: "text-destructive",
    };
  }

  return { label: "0.00%", className: "text-foreground" };
};

type ActionMode = "deposit" | "redeem" | null;

type HistoryChartPoint = {
  timestamp: number;
  value: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseWadNumber = (value: string): number => {
  try {
    const parsed = Number(formatUnits(value || "0", 18));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const buildPriceChartData = (
  history: SaveUsdstHistoryPoint[],
  currentPrice: string
): HistoryChartPoint[] => {
  const points = history
    .map((point) => ({
      timestamp: point.timestamp,
      value: parseWadNumber(point.exchangeRate),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && point.timestamp > 0 && point.value > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  return appendCurrentHistoryPoint(points, parseWadNumber(currentPrice));
};

const buildTvlChartData = (
  history: SaveUsdstHistoryPoint[],
  currentTvl: string
): HistoryChartPoint[] => {
  const points = history
    .map((point) => ({
      timestamp: point.timestamp,
      value: parseWadNumber(point.pricingAssets),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && point.timestamp > 0 && point.value > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  return appendCurrentHistoryPoint(points, parseWadNumber(currentTvl));
};

const appendCurrentHistoryPoint = (
  points: HistoryChartPoint[],
  currentValue: number
): HistoryChartPoint[] => {
  if (currentValue > 0) {
    const nowPoint = {
      timestamp: Date.now(),
      value: currentValue,
    };
    const latest = points[points.length - 1];
    if (!latest || Math.abs(latest.timestamp - nowPoint.timestamp) > 60_000) {
      points.push(nowPoint);
    } else {
      points[points.length - 1] = nowPoint;
    }
  }

  return points;
};

const getHistoryDomain = (data: HistoryChartPoint[]): [number, number] => {
  const values = data.map((point) => point.value).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return [0, 1];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const padding = range > 0 ? range * 0.2 : min * 0.001;

  return [Math.max(0, min - padding), max + padding];
};

const getHistoryPerformance = (data: HistoryChartPoint[], days?: number): number | null => {
  if (data.length < 2) return null;

  const latest = data[data.length - 1];
  let start = data[0];

  if (days) {
    const threshold = latest.timestamp - (days * DAY_MS);
    for (const point of data) {
      if (point.timestamp <= threshold) {
        start = point;
      } else {
        break;
      }
    }
  }

  if (start.value <= 0 || latest.timestamp <= start.timestamp) return null;
  return ((latest.value / start.value) - 1) * 100;
};

const formatChartDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const formatFullChartDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

type VaultLineChartProps = {
  title: string;
  value: string;
  subtitle: string;
  data: HistoryChartPoint[];
  domain: [number, number];
  color: { light: string; dark: string };
  valueFormatter: (value: number) => string;
  yTickFormatter: (value: number) => string;
  emptyMessage: string;
};

const VaultLineChart = ({
  title,
  value,
  subtitle,
  data,
  domain,
  color,
  valueFormatter,
  yTickFormatter,
  emptyMessage,
}: VaultLineChartProps) => (
  <div className="rounded-lg border border-border/60 bg-card/60 p-4 space-y-4">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </div>
      <p className="text-xs text-muted-foreground sm:text-right">{subtitle}</p>
    </div>

    <div className="h-[220px] w-full">
      {data.length > 1 ? (
        <ChartContainer
          config={{
            value: {
              theme: {
                light: color.light,
                dark: color.dark,
              },
            },
          }}
          className="h-full w-full"
        >
          <LineChart
            data={data}
            margin={{ top: 12, right: 12, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={["dataMin", "dataMax"]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={formatChartDate}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={72}
              domain={domain}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(chartValue) => yTickFormatter(Number(chartValue))}
            />
            <ChartTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;

                const point = payload[0].payload as HistoryChartPoint;
                return (
                  <div className="rounded-lg border border-border bg-popover p-3 text-sm shadow-lg">
                    <p className="text-xs text-muted-foreground">{formatFullChartDate(point.timestamp)}</p>
                    <p className="mt-1 font-semibold text-popover-foreground">
                      {valueFormatter(point.value)}
                    </p>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={title}
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: "var(--color-value)" }}
              animationDuration={350}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <div className="flex h-full items-center justify-center rounded-md bg-muted/30 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </div>
  </div>
);

const EarnSave = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { tokenApys } = useEarnContext();
  const { usdstBalance, fetchUsdstBalance, getEarningAssets, refreshNetBalance } = useTokenContext();
  const { toast } = useToast();
  const { activities: rewardsActivities, loading: rewardsActivitiesLoading } = useRewardsActivities();
  const { userRewards, loading: rewardsUserLoading } = useRewardsUserInfo();
  const {
    saveUsdstInfo: saveInfo,
    saveUsdstUserInfo: userInfo,
    saveUsdstHistory,
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
  const currentPricingAssets =
    effectiveInfo?.projectedPricingAssets || effectiveInfo?.pricingAssets || "0";
  const currentTvlUsd =
    effectiveInfo?.projectedTvlUsd || effectiveInfo?.tvlUsd || "0";
  const currentTvlChartValue = currentTvlUsd !== "0" ? currentTvlUsd : currentPricingAssets;
  const exchangeRateRaw = effectiveInfo?.projectedExchangeRate || effectiveInfo?.exchangeRate || "0";
  const price = formatPrice(exchangeRateRaw);
  const fullPrice = formatFullPrice(exchangeRateRaw);
  const tvlDisplay = loadingInfo
    ? "..."
    : formatUsdAmount(currentTvlUsd);
  const userShares = userInfo?.userShares || "0";
  const redeemableAssets = userInfo?.projectedRedeemableAssets || userInfo?.redeemableAssets || "0";
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
  const incentiveYieldInfo = useMemo(
    () => findBestEarnApyInfo(tokenApys, effectiveInfo?.vaultAddress),
    [effectiveInfo?.vaultAddress, tokenApys]
  );
  const incentiveYieldDisplay = formatApyDisplay(
    incentiveYieldInfo?.total.toFixed(2)
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
  const isInsolvent = BigInt(effectiveInfo?.totalShares || "0") > 0n && BigInt(currentPricingAssets) === 0n;
  const depositDisabled = !isLoggedIn || !isConfigured || !isDeployed || isPaused || isInsolvent;
  const redeemDisabled = !isLoggedIn || !isConfigured || !isDeployed || isPaused;
  const priceChartData = useMemo(
    () => buildPriceChartData(saveUsdstHistory, exchangeRateRaw),
    [saveUsdstHistory, exchangeRateRaw]
  );
  const tvlChartData = useMemo(
    () => buildTvlChartData(saveUsdstHistory, currentTvlChartValue),
    [saveUsdstHistory, currentTvlChartValue]
  );
  const priceDomain = useMemo(() => getHistoryDomain(priceChartData), [priceChartData]);
  const tvlDomain = useMemo(() => getHistoryDomain(tvlChartData), [tvlChartData]);
  const sevenDayPerformance = useMemo(() => getHistoryPerformance(priceChartData, 7), [priceChartData]);
  const thirtyDayPerformance = useMemo(() => getHistoryPerformance(priceChartData, 30), [priceChartData]);
  const allTimePerformance = useMemo(() => getHistoryPerformance(priceChartData), [priceChartData]);
  const performanceStats = [
    {
      label: "7D Performance",
      value: formatPerformance(sevenDayPerformance),
    },
    {
      label: "30D Performance",
      value: formatPerformance(thirtyDayPerformance),
    },
    {
      label: "All Time Performance",
      value: formatPerformance(allTimePerformance),
    },
  ];

  const amountWei = actionAmount ? safeParseUnits(actionAmount, 18) : 0n;
  const actionMaxWei = useMemo(() => {
    if (actionMode === "deposit") return BigInt(userInfo?.maxDeposit || "0");
    if (actionMode === "redeem") return BigInt(userInfo?.maxRedeem || "0");
    return 0n;
  }, [actionMode, userInfo?.maxDeposit, userInfo?.maxRedeem]);

  const previewValueWei = useMemo(() => {
    const pricingAssets = BigInt(currentPricingAssets);
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
  }, [actionMode, amountWei, currentPricingAssets, effectiveInfo?.totalShares]);

  const isActionAmountValid = amountWei > 0n && amountWei <= actionMaxWei;

  const userMetrics = [
    {
      label: "USDST Balance",
      value: loadingInfo ? "..." : isLoggedIn ? formatTokenAmount(usdstBalance) : "--",
      icon: <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
    },
    {
      label: "Your saveUSDST",
      value: loadingInfo ? "..." : isLoggedIn ? formatTokenAmount(userShares) : "--",
      icon: <PiggyBank className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      label: "Position Value",
      value: loadingInfo ? "..." : isLoggedIn ? `${formatTokenAmount(redeemableAssets)} USDST` : "--",
      icon: <CircleDollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />,
    },
    {
      label: "Rewards / Day",
      value: loadingInfo || rewardsUserLoading ? "..." : isLoggedIn ? `${saveRewardPointsPerDay} points` : "--",
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
      await Promise.all([refreshSaveUsdst(), fetchUsdstBalance(), getEarningAssets(false), refreshNetBalance()]);
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
      await Promise.all([refreshSaveUsdst(), fetchUsdstBalance(), getEarningAssets(false), refreshNetBalance()]);
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
              <CardContent className="p-3 md:p-4 space-y-4">
                <button
                  className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => navigate("/dashboard/earn")}
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Earn
                </button>

                <section className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-[9px] uppercase tracking-wide">
                      Native Savings
                    </Badge>
                    <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                      USDST Only
                    </Badge>
                    {!isConfigured && (
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                        Needs Config
                      </Badge>
                    )}
                    {isConfigured && !isDeployed && (
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                        Not Deployed
                      </Badge>
                    )}
                    {isPaused && (
                      <Badge variant="outline" className="text-[9px] uppercase tracking-wide">
                        Paused
                      </Badge>
                    )}
                  </div>

                  <Card className="border border-blue-500/25 dark:border-blue-400/25 bg-gradient-to-br from-[#f8fbff] to-[#edf3ff] dark:from-[#0f1a33] dark:to-[#111c3a]">
                    <CardContent className="p-3 md:p-4">
                      <div className="space-y-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center">
                              <PiggyBank className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Save USDST</h1>
                              <p className="text-xs text-muted-foreground">
                                Simple USD savings, natively on STRATO.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:min-w-[300px]">
                            <Button
                              className="h-9"
                              onClick={() => handleActionRequest("deposit")}
                              disabled={depositDisabled}
                            >
                              Deposit USDST
                            </Button>
                            <Button
                              variant="outline"
                              className="h-9"
                              onClick={() => handleActionRequest("redeem")}
                              disabled={redeemDisabled}
                            >
                              Redeem saveUSDST
                            </Button>
                          </div>
                        </div>
                        {actionDisabledReason && (
                          <p className="text-xs text-muted-foreground">{actionDisabledReason}</p>
                        )}

                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                              <p className="text-muted-foreground">Current Price</p>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p className="mt-1 text-base font-semibold cursor-default">{price}</p>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-mono text-xs">{fullPrice}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                              <p className="text-muted-foreground">TVL</p>
                              <p className="mt-1 text-base font-semibold">{tvlDisplay}</p>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                              <p className="text-muted-foreground inline-flex items-center gap-1">
                                Best Available APY
                                <BestApyInfoTooltip />
                              </p>
                              {loadingInfo || rewardsActivitiesLoading ? (
                                <p className="mt-1 text-base font-semibold">...</p>
                              ) : (
                                <EarnApyTooltip info={incentiveYieldInfo}>
                                  <p className={`mt-1 text-base font-semibold cursor-default ${incentiveYieldDisplay.className}`}>
                                    {incentiveYieldDisplay.label}
                                  </p>
                                </EarnApyTooltip>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Your Position</p>
                            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                              {userMetrics.map((metric) => (
                                <div key={metric.label} className="rounded-lg border border-border/60 bg-background/70 p-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-muted-foreground">{metric.label}</p>
                                    {metric.icon}
                                  </div>
                                  <p className="mt-1 text-base font-semibold leading-tight">{metric.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section className="rounded-lg border border-border/70 bg-background/60 p-3 md:p-4 space-y-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-sm font-semibold">Vault Performance</h2>
                      <p className="text-xs text-muted-foreground">Historical saveUSDST price and TVL</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Native APY {effectiveInfo?.apy && effectiveInfo.apy !== "-" ? `${effectiveInfo.apy}%` : "--"}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <VaultLineChart
                      title="Price"
                      value={loadingInfo ? "..." : price}
                      subtitle="1 saveUSDST redeem value"
                      data={priceChartData}
                      domain={priceDomain}
                      color={{ light: "#2563eb", dark: "#60a5fa" }}
                      valueFormatter={formatPriceNumber}
                      yTickFormatter={(value) => value.toFixed(6)}
                      emptyMessage="No price history yet"
                    />
                    <VaultLineChart
                      title="TVL"
                      value={tvlDisplay}
                      subtitle="Total value saved"
                      data={tvlChartData}
                      domain={tvlDomain}
                      color={{ light: "#059669", dark: "#34d399" }}
                      valueFormatter={formatUsdNumber}
                      yTickFormatter={formatCompactUsdNumber}
                      emptyMessage="No TVL history yet"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {performanceStats.map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-border/60 bg-card/60 p-4">
                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                        <p className="mt-2 text-xl font-semibold">{loadingInfo ? "..." : stat.value}</p>
                      </div>
                    ))}
                  </div>
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
                <span className="font-medium text-foreground">{formatTokenAmount(usdstBalance)}</span>
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
