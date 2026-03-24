import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileSidebar from "@/components/dashboard/MobileSidebar";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { getConfig } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useVaultContext } from "@/context/VaultContext";
import { useSwapContext } from "@/context/SwapContext";
import { useLendingContext } from "@/context/LendingContext";
import { useSaveUsdstContext } from "@/context/SaveUsdstContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useToast } from "@/hooks/use-toast";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidityDepositModal from "@/components/dashboard/LiquidityDepositModal";
import LiquidityWithdrawModal from "@/components/dashboard/LiquidityWithdrawModal";
import VaultDepositModal from "@/components/vault/VaultDepositModal";
import type { Pool } from "@/interface";
import { formatUnits } from "ethers";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { CircleArrowDown, PiggyBank, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import stratoVaultLogo from "@/assets/strato-vault-logo.png";
import {
  mUsdstAddress,
  LENDING_DEPOSIT_FEE,
  rewardsEnabled,
} from "@/lib/constants";

const WAD = BigInt(10) ** BigInt(18);
const TOP_OPPORTUNITY_MIN_POOL_TVL = 100000n * WAD;
const CATA_PRICE_USD = 0.25;

const safeBigInt = (value: string | undefined | null): bigint => {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
};

const formatUsd = (value: string): string => {
  try {
    return Number(formatUnits(value, 18)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const formatTokenAmount = (value: string): string => {
  try {
    return Number(formatUnits(value || "0", 18)).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  } catch {
    return "0";
  }
};

const normalizeAddress = (value?: string | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const parseApy = (value: string | number | undefined): number => {
  if (!value || value === "-") return Number.NEGATIVE_INFINITY;
  const apy = Number(value);
  if (!Number.isFinite(apy)) return Number.NEGATIVE_INFINITY;
  if (apy <= 0 || Math.abs(apy) < 0.005) return Number.NEGATIVE_INFINITY;
  return apy;
};

const isPoolPaused = (pool: Pool): boolean => Boolean((pool as any).isPaused);
const isPoolDisabled = (pool: Pool): boolean => Boolean((pool as any).isDisabled);

const formatApyDisplay = (value: string | number | undefined): { label: string; className: string } => {
  if (!value || value === "-") {
    return { label: "--", className: "text-foreground" };
  }

  const apy = Number(value);
  if (!Number.isFinite(apy)) {
    return { label: "--", className: "text-foreground" };
  }

  if (apy <= 0 || Math.abs(apy) < 0.005) {
    return { label: "--", className: "text-foreground" };
  }

  const sign = apy >= 0 ? "+" : "-";
  const className = apy >= 0
    ? "text-green-600 dark:text-green-400"
    : "text-foreground";

  return { label: `${sign}${Math.abs(apy).toFixed(2)}%`, className };
};

const getEstimatedIncentiveApy = (
  nativeApyPercent?: string | number | null,
  emissionRate?: string,
  totalStakeUsd?: string | null
): number => {
  try {
    const nativeApy =
      nativeApyPercent === null ||
      nativeApyPercent === undefined ||
      nativeApyPercent === "" ||
      nativeApyPercent === "-"
        ? 0
        : Number(nativeApyPercent);
    const hasNativeApy = Number.isFinite(nativeApy) && nativeApy > 0;
    if (!Number.isFinite(nativeApy)) {
      return Number.NEGATIVE_INFINITY;
    }

    if (!emissionRate || !totalStakeUsd) {
      return hasNativeApy ? Number(nativeApy.toFixed(2)) : Number.NEGATIVE_INFINITY;
    }

    const tvlUsd = Number(BigInt(totalStakeUsd)) / 1e18;
    if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) {
      return hasNativeApy ? Number(nativeApy.toFixed(2)) : Number.NEGATIVE_INFINITY;
    }

    const annualCata = (Number(BigInt(emissionRate)) / 1e18) * 86400 * 365;
    if (!Number.isFinite(annualCata) || annualCata < 0) {
      return hasNativeApy ? Number(nativeApy.toFixed(2)) : Number.NEGATIVE_INFINITY;
    }

    const rewardsApy = ((annualCata * CATA_PRICE_USD) / tvlUsd) * 100;
    const totalApy = nativeApy + rewardsApy;
    if (!Number.isFinite(totalApy) || totalApy <= 0) {
      return hasNativeApy ? Number(nativeApy.toFixed(2)) : Number.NEGATIVE_INFINITY;
    }

    return Number(totalApy.toFixed(2));
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
};

const formatPointsMultiplier = (scaledTenths: bigint): string => {
  const whole = scaledTenths / 10n;
  const frac = scaledTenths % 10n;
  if (frac === 0n) return `${whole.toString()}x points`;
  return `${whole.toString()}.${frac.toString()}x points`;
};

const formatMaxAmount = (weiAmount: bigint): string => {
  const [whole, frac = ""] = formatUnits(weiAmount, 18).split(".");
  return `${whole}.${frac.slice(0, 18)}`.replace(/\.?0+$/, "");
};

const TokenPairIcon = ({ pool, size = "sm" }: { pool: Pool; size?: "sm" | "lg" }) => {
  const iconClass = size === "lg" ? "w-14 h-14" : "w-7 h-7";
  const textClass = size === "lg" ? "text-lg" : "text-[10px]";
  const overlapClass = size === "lg" ? "-space-x-4" : "-space-x-2";
  return (
    <div className={`flex items-center ${overlapClass} shrink-0`}>
      {pool.tokenA?.images?.[0]?.value ? (
        <img
          src={pool.tokenA.images[0].value}
          alt={pool.tokenA._symbol}
          className={`${iconClass} rounded-full border-2 border-background object-cover`}
        />
      ) : (
        <div className={`${iconClass} rounded-full border-2 border-background bg-blue-500/20 flex items-center justify-center ${textClass} font-semibold`}>
          {(pool.tokenA?._symbol || "A").slice(0, 1)}
        </div>
      )}
      {pool.tokenB?.images?.[0]?.value ? (
        <img
          src={pool.tokenB.images[0].value}
          alt={pool.tokenB._symbol}
          className={`${iconClass} rounded-full border-2 border-background object-cover`}
        />
      ) : (
        <div className={`${iconClass} rounded-full border-2 border-background bg-purple-500/20 flex items-center justify-center ${textClass} font-semibold`}>
          {(pool.tokenB?._symbol || "B").slice(0, 1)}
        </div>
      )}
    </div>
  );
};

const Earn = () => {
  type OpportunityRow =
    | { kind: "saveUsdst"; apySortValue: number }
    | { kind: "vault"; apySortValue: number }
    | { kind: "lending"; apySortValue: number }
    | { kind: "pool"; apySortValue: number; pool: Pool };

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "vaults" | "pools">("all");
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [isPoolDepositModalOpen, setIsPoolDepositModalOpen] = useState(false);
  const [isPoolWithdrawModalOpen, setIsPoolWithdrawModalOpen] = useState(false);
  const [isVaultDepositModalOpen, setIsVaultDepositModalOpen] = useState(false);
  const [isLendingDepositModalOpen, setIsLendingDepositModalOpen] = useState(false);
  const [lendingDepositAmount, setLendingDepositAmount] = useState("");
  const [stakeLendingRewards, setStakeLendingRewards] = useState<boolean>(rewardsEnabled);
  const [isLendingSubmitting, setIsLendingSubmitting] = useState(false);
  const [featuredOpportunityKey, setFeaturedOpportunityKey] = useState("");
  const operationInProgressRef = useRef(false);

  const { vaultState, refreshVault } = useVaultContext();
  const { pools, fetchPools, poolsLoading } = useSwapContext();
  const { liquidityInfo, loadingLiquidity, refreshLiquidity, depositLiquidity } = useLendingContext();
  const { saveUsdstInfo } = useSaveUsdstContext();
  const { earningAssets, usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { activities: rewardsActivities } = useRewardsActivities();
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const guestMode = !isLoggedIn;
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "STRATO Vault | STRATO";
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const config = await getConfig();
        if (!cancelled) {
          setFeaturedOpportunityKey(config.featuredEarnOpportunity || "");
        }
      } catch {
        if (!cancelled) {
          setFeaturedOpportunityKey("");
        }
      }
    };

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      fetchUsdstBalance();
    }
  }, [isLoggedIn, fetchUsdstBalance]);

  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  const handlePoolDeposit = (pool: Pool) => {
    if (!isLoggedIn) return;
    setSelectedPool(pool);
    setIsPoolDepositModalOpen(true);
  };

  const handlePoolWithdraw = (pool: Pool) => {
    if (!isLoggedIn) return;
    setSelectedPool(pool);
    setIsPoolWithdrawModalOpen(true);
  };

  const navigateToPoolDetails = (pool: Pool) => {
    navigate(`/dashboard/earn-pools?pool=${pool.address}`);
  };

  const handlePoolActionSuccess = async () => {
    await Promise.all([
      fetchPools(),
      refreshVault(false),
      isLoggedIn ? fetchUsdstBalance() : Promise.resolve(),
    ]);
  };

  const handleVaultDepositClick = () => {
    if (!isLoggedIn) return;
    setIsVaultDepositModalOpen(true);
  };

  const handleVaultDepositSuccess = () => {
    refreshVault(false);
    if (isLoggedIn) {
      fetchUsdstBalance();
    }
  };

  const closeLendingDepositModal = () => {
    setIsLendingDepositModalOpen(false);
    setLendingDepositAmount("");
    setStakeLendingRewards(rewardsEnabled);
  };

  const handleLendingDepositClick = () => {
    if (!isLoggedIn) return;
    setIsLendingDepositModalOpen(true);
  };

  const isValidDecimalInput = (value: string) => /^\d+(\.\d{1,18})?$/.test(value);

  const isLendingDepositValid = useMemo(() => {
    if (!lendingDepositAmount || !isValidDecimalInput(lendingDepositAmount)) return false;
    try {
      const amountWei = safeParseUnits(lendingDepositAmount, 18);
      const availableWei = safeBigInt(liquidityInfo?.supplyable?.userBalance);
      const feeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
      return amountWei > 0n && amountWei <= availableWei && amountWei + feeWei <= availableWei;
    } catch {
      return false;
    }
  }, [lendingDepositAmount, liquidityInfo?.supplyable?.userBalance]);

  const handleLendingDepositSubmit = async () => {
    if (!isLoggedIn || !isLendingDepositValid || isLendingSubmitting) return;
    try {
      setIsLendingSubmitting(true);
      await depositLiquidity({
        amount: safeParseUnits(lendingDepositAmount, 18).toString(),
      });
      closeLendingDepositModal();
      toast({
        title: "Deposit Successful",
        description: `You have successfully deposited ${lendingDepositAmount} USDST.`,
        variant: "success",
      });
      await Promise.all([refreshLiquidity(), fetchPools(), fetchUsdstBalance()]);
    } catch {
    } finally {
      setIsLendingSubmitting(false);
    }
  };

  const sortedPools = useMemo(() => {
    return [...(pools || [])]
      .filter((pool) => !isPoolPaused(pool) && !isPoolDisabled(pool))
      .sort((a, b) => parseApy(b.apy) - parseApy(a.apy));
  }, [pools]);

  const saveUsdstAsset = useMemo(() => {
    return earningAssets.find((asset) => {
      const symbol = asset._symbol?.toLowerCase?.() || "";
      const name = asset._name?.toLowerCase?.() || "";
      return symbol === "saveusdst" || name.includes("save usdst") || name.includes("saveusdst");
    });
  }, [earningAssets]);

  const saveUsdstRewardsActivity = useMemo(() => {
    return rewardsActivities.find((activity) => {
      const source = activity.sourceContract?.toLowerCase?.() || "";
      const name = activity.name?.toLowerCase?.() || "";
      const saveAddress = saveUsdstAsset?.address?.toLowerCase?.() || "";

      if (saveAddress && source === saveAddress) {
        return true;
      }

      return name.includes("save usdst") || name.includes("saveusdst");
    }) || null;
  }, [rewardsActivities, saveUsdstAsset?.address]);

  const saveUsdstNativeApy = saveUsdstInfo?.apy ?? saveUsdstAsset?.apy;

  const saveUsdstEstimatedApy = useMemo(() => {
    return getEstimatedIncentiveApy(
      saveUsdstNativeApy,
      saveUsdstRewardsActivity?.emissionRate,
      saveUsdstRewardsActivity?.totalStakeUsd ??
        saveUsdstInfo?.tvlUsd ??
        saveUsdstInfo?.pricingAssets ??
        saveUsdstInfo?.totalAssets ??
        null
    );
  }, [
    saveUsdstNativeApy,
    saveUsdstInfo?.tvlUsd,
    saveUsdstInfo?.pricingAssets,
    saveUsdstInfo?.totalAssets,
    saveUsdstRewardsActivity,
  ]);

  const saveUsdstTvl = useMemo(() => {
    if (saveUsdstInfo?.deployed && saveUsdstInfo.tvlUsd) {
      return saveUsdstInfo.tvlUsd;
    }

    if (saveUsdstInfo?.deployed && saveUsdstInfo.pricingAssets) {
      return saveUsdstInfo.pricingAssets;
    }

    if (saveUsdstInfo?.deployed && saveUsdstInfo.totalAssets) {
      return saveUsdstInfo.totalAssets;
    }

    return saveUsdstRewardsActivity?.totalStakeUsd || "0";
  }, [saveUsdstInfo, saveUsdstRewardsActivity]);

  const getOpportunityTvl = (opportunity: OpportunityRow): bigint => {
    if (opportunity.kind === "saveUsdst") return safeBigInt(saveUsdstTvl);
    if (opportunity.kind === "vault") return safeBigInt(vaultState.totalEquity);
    if (opportunity.kind === "lending") return safeBigInt(liquidityInfo?.totalUSDSTSupplied?.toString());
    return safeBigInt(opportunity.pool.totalLiquidityUSD);
  };

  const getOpportunitySimplicityRank = (opportunity: OpportunityRow): number => {
    if (opportunity.kind === "saveUsdst") return 0;
    if (opportunity.kind === "vault") return 1;
    if (opportunity.kind === "lending") return 2;
    return 3;
  };

  const compareOpportunities = (a: OpportunityRow, b: OpportunityRow): number => {
    if (b.apySortValue !== a.apySortValue) {
      return b.apySortValue - a.apySortValue;
    }

    const simplicityDiff = getOpportunitySimplicityRank(a) - getOpportunitySimplicityRank(b);
    if (simplicityDiff !== 0) {
      return simplicityDiff;
    }

    const tvlA = getOpportunityTvl(a);
    const tvlB = getOpportunityTvl(b);
    if (tvlA !== tvlB) {
      return tvlA > tvlB ? -1 : 1;
    }

    return 0;
  };

  const isEligibleForTopOpportunity = (opportunity: OpportunityRow): boolean => {
    if (opportunity.kind !== "pool") return true;
    return getOpportunityTvl(opportunity) >= TOP_OPPORTUNITY_MIN_POOL_TVL;
  };

  const isSameOpportunity = (a: OpportunityRow, b: OpportunityRow | null): boolean => {
    if (!b || a.kind !== b.kind) return false;
    if (a.kind === "pool" && b.kind === "pool") {
      return normalizeAddress(a.pool.address) === normalizeAddress(b.pool.address);
    }
    return true;
  };

  const getOpportunityPositionValue = (opportunity: OpportunityRow): string => {
    if (guestMode) return "--";

    if (opportunity.kind === "saveUsdst") {
      return `$${saveUsdstAsset?.value || "0.00"}`;
    }

    if (opportunity.kind === "vault") {
      return `$${formatUsd(vaultState.userValueUsd || "0")}`;
    }

    if (opportunity.kind === "lending") {
      return `$${formatUsd(liquidityInfo?.withdrawable?.userBalance || "0")}`;
    }

    const lpBalance = safeBigInt(opportunity.pool.lpToken?.totalBalance);
    const lpPrice = safeBigInt(opportunity.pool.lpToken?.price);
    const depositedUsd = lpPrice > 0n ? (lpBalance * lpPrice) / WAD : 0n;
    return `$${formatUsd(depositedUsd.toString())}`;
  };

  const allOpportunities = useMemo<OpportunityRow[]>(() => {
    const rows: OpportunityRow[] = [];

    if (activeFilter === "all" || activeFilter === "vaults") {
      rows.push({ kind: "saveUsdst", apySortValue: saveUsdstEstimatedApy });
      rows.push({ kind: "vault", apySortValue: parseApy(vaultState.alpha) });
    }

    if (activeFilter === "all" || activeFilter === "pools") {
      rows.push({ kind: "lending", apySortValue: parseApy(liquidityInfo?.supplyAPY) });
      for (const pool of sortedPools) {
        rows.push({ kind: "pool", apySortValue: parseApy(pool.apy), pool });
      }
    }

    return rows.sort(compareOpportunities);
  }, [activeFilter, liquidityInfo?.supplyAPY, saveUsdstEstimatedApy, saveUsdstTvl, sortedPools, vaultState.alpha, vaultState.totalEquity, liquidityInfo?.totalUSDSTSupplied]);

  const vaultAlpha = formatApyDisplay(vaultState.alpha);
  const rankedTopCandidates = useMemo<OpportunityRow[]>(() => {
    const candidates: OpportunityRow[] = [
      { kind: "saveUsdst", apySortValue: saveUsdstEstimatedApy },
      { kind: "vault", apySortValue: parseApy(vaultState.alpha) },
      { kind: "lending", apySortValue: parseApy(liquidityInfo?.supplyAPY) },
      ...sortedPools.map((pool) => ({
        kind: "pool" as const,
        apySortValue: parseApy(pool.apy),
        pool,
      })),
    ];
    const rankedCandidates = [...candidates].sort(compareOpportunities);
    return rankedCandidates.filter(isEligibleForTopOpportunity).length > 0
      ? rankedCandidates.filter(isEligibleForTopOpportunity)
      : rankedCandidates;
  }, [liquidityInfo?.supplyAPY, liquidityInfo?.totalUSDSTSupplied, saveUsdstEstimatedApy, saveUsdstTvl, sortedPools, vaultState.alpha, vaultState.totalEquity]);

  const rewardActivityByContract = useMemo(() => {
    const map = new Map<string, { emissionRate: bigint }>();
    for (const activity of rewardsActivities || []) {
      const contract = activity.sourceContract?.toLowerCase();
      if (!contract) continue;
      try {
        map.set(contract, { emissionRate: BigInt(activity.emissionRate || "0") });
      } catch {
        map.set(contract, { emissionRate: 0n });
      }
    }
    return map;
  }, [rewardsActivities]);

  const rewardsBaseEmission = useMemo(() => {
    const emissions: bigint[] = [];

    const vaultContract = vaultState.shareTokenAddress?.toLowerCase();
    if (vaultContract) {
      const vaultActivity = rewardActivityByContract.get(vaultContract);
      if (vaultActivity && vaultActivity.emissionRate > 0n) emissions.push(vaultActivity.emissionRate);
    }

    for (const pool of sortedPools) {
      const activity = rewardActivityByContract.get(pool.lpToken?.address?.toLowerCase());
      if (activity && activity.emissionRate > 0n) emissions.push(activity.emissionRate);
    }

    const lendingActivity = rewardActivityByContract.get(mUsdstAddress.toLowerCase());
    if (lendingActivity && lendingActivity.emissionRate > 0n) emissions.push(lendingActivity.emissionRate);

    if (emissions.length === 0) return 0n;
    return emissions.reduce((min, curr) => (curr < min ? curr : min), emissions[0]);
  }, [rewardActivityByContract, sortedPools, vaultState.shareTokenAddress]);

  const getRewardMeta = (contractAddress?: string) => {
    const contract = contractAddress?.toLowerCase();
    if (!contract || rewardsBaseEmission <= 0n) {
      return { pointsLabel: "-", featured: false };
    }
    const activity = rewardActivityByContract.get(contract);
    if (!activity || activity.emissionRate <= 0n) {
      return { pointsLabel: "-", featured: false };
    }
    const scaledTenths = (activity.emissionRate * 10n + rewardsBaseEmission / 2n) / rewardsBaseEmission;
    const featured = scaledTenths >= 15n;
    return {
      pointsLabel: formatPointsMultiplier(scaledTenths),
      featured,
    };
  };

  const vaultRewardMeta = getRewardMeta(vaultState.shareTokenAddress);
  const lendingRewardMeta = getRewardMeta(mUsdstAddress);
  const saveUsdstRewardMeta = getRewardMeta(saveUsdstRewardsActivity?.sourceContract || saveUsdstAsset?.address);
  const getOpportunityMeta = (opportunity: OpportunityRow) => {
    if (opportunity.kind === "saveUsdst") {
      return {
        title: "Savings Vault",
        subtitle: "Stable USD savings with yield plus rewards",
        apyRaw: saveUsdstEstimatedApy,
        tvl: saveUsdstTvl,
        badge: "Savings Vault",
        rateLabel: "APY",
        actionLabel: "Deposit",
        onCardClick: () => navigate("/dashboard/earn-save"),
        onActionClick: () => navigate("/dashboard/earn-save"),
      };
    }

    if (opportunity.kind === "vault") {
      return {
        title: "Diversified Vault",
        subtitle: "Diversified real assets: gold, silver, ETH, BTC, stables - actively managed",
        apyRaw: vaultState.alpha,
        tvl: vaultState.totalEquity,
        badge: "Diversified Vault",
        rateLabel: "APY",
        actionLabel: "Deposit",
        onCardClick: () => navigate("/dashboard/earn-vault"),
        onActionClick: () => handleVaultDepositClick(),
      };
    }

    if (opportunity.kind === "lending") {
      return {
        title: "USDST Lending Pool",
        subtitle: "Earn yield by supplying USDST liquidity",
        apyRaw: liquidityInfo?.supplyAPY?.toString(),
        tvl: liquidityInfo?.totalUSDSTSupplied?.toString() || "0",
        badge: "Lending",
        rateLabel: "APY",
        actionLabel: "Deposit",
        onCardClick: () => navigate("/dashboard/earn-lending"),
        onActionClick: () => handleLendingDepositClick(),
      };
    }

    const pool = opportunity.pool;
    return {
      title: pool.poolName,
      subtitle: `Earn fees on ${pool.poolName.replace(" Pool", "")} swaps`,
      apyRaw: pool.apy,
      tvl: pool.totalLiquidityUSD,
      badge: "Pool",
      rateLabel: "APY",
      actionLabel: "Deposit",
      onCardClick: () => navigateToPoolDetails(pool),
      onActionClick: () => handlePoolDeposit(pool),
      pool,
    };
  };

  const configuredFeaturedOpportunity = useMemo<OpportunityRow | null>(() => {
    const key = featuredOpportunityKey.trim().toLowerCase();
    if (!key) return null;

    if (key === "save-usdst" || key === "saveusdst") {
      return { kind: "saveUsdst", apySortValue: saveUsdstEstimatedApy };
    }

    if (key === "vault") {
      return { kind: "vault", apySortValue: parseApy(vaultState.alpha) };
    }

    if (key === "lending") {
      return { kind: "lending", apySortValue: parseApy(liquidityInfo?.supplyAPY) };
    }

    if (key.startsWith("pool:")) {
      const targetAddress = normalizeAddress(key.slice(5));
      const pool = sortedPools.find((candidate) => normalizeAddress(candidate.address) === targetAddress);
      if (pool) {
        return { kind: "pool", apySortValue: parseApy(pool.apy), pool };
      }
    }

    return null;
  }, [
    featuredOpportunityKey,
    liquidityInfo?.supplyAPY,
    saveUsdstEstimatedApy,
    sortedPools,
    vaultState.alpha,
  ]);

  const topOpportunity = useMemo<OpportunityRow>(() => {
    const fallback = rankedTopCandidates[0] ?? {
      kind: "saveUsdst",
      apySortValue: Number.NEGATIVE_INFINITY,
    };

    if (!configuredFeaturedOpportunity) {
      return fallback;
    }

    return (
      rankedTopCandidates.find((candidate) => !isSameOpportunity(candidate, configuredFeaturedOpportunity)) ??
      fallback
    );
  }, [configuredFeaturedOpportunity, rankedTopCandidates]);

  const topOpportunityMeta = useMemo(() => getOpportunityMeta(topOpportunity), [topOpportunity, saveUsdstEstimatedApy, saveUsdstTvl, vaultState.alpha, vaultState.totalEquity, liquidityInfo?.supplyAPY, liquidityInfo?.totalUSDSTSupplied, navigate]);
  const topOpportunityApy = formatApyDisplay(topOpportunityMeta.apyRaw);
  const featuredOpportunityMeta = useMemo(
    () => (configuredFeaturedOpportunity ? getOpportunityMeta(configuredFeaturedOpportunity) : null),
    [
      configuredFeaturedOpportunity,
      saveUsdstEstimatedApy,
      saveUsdstTvl,
      vaultState.alpha,
      vaultState.totalEquity,
      liquidityInfo?.supplyAPY,
      liquidityInfo?.totalUSDSTSupplied,
      navigate,
    ]
  );
  const featuredOpportunityApy = formatApyDisplay(featuredOpportunityMeta?.apyRaw);

  const pageLoading =
    vaultState.loading ||
    (isLoggedIn && vaultState.loadingUser) ||
    (poolsLoading && (pools?.length || 0) === 0);

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardSidebar />
        <MobileSidebar
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
        />

        <div
          className="transition-all duration-300 md:pl-64"
          style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
        >
          <DashboardHeader title="Earn Opportunities" />

          <main className="p-4 md:p-6 pb-16 md:pb-6 space-y-6">
            <Skeleton className="h-7 w-44" />
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <Skeleton className="h-28 w-full rounded-lg" />
                <Skeleton className="h-28 w-full rounded-lg" />
                <Skeleton className="h-28 w-full rounded-lg" />
              </div>
            </div>
            <Skeleton className="h-40 w-full rounded-lg" />
          </main>
        </div>

        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="Earn Opportunities" />

        <main className="p-4 md:p-6 pb-16 md:pb-6 space-y-8">
          {guestMode && (
            <GuestSignInBanner message="Sign in to view your positions and manage pool deposits or withdrawals" />
          )}

          <section>
            <div className={`grid grid-cols-1 gap-4 ${configuredFeaturedOpportunity && featuredOpportunityMeta ? "xl:grid-cols-2" : ""}`}>
              {configuredFeaturedOpportunity && featuredOpportunityMeta && (
                <div>
                  <Card
                    className="border border-amber-500/40 dark:border-amber-400/35 bg-gradient-to-br from-[#fffaf0] to-[#fff4db] dark:from-[#24190a] dark:to-[#2b1d0c] shadow-sm cursor-pointer h-full"
                    role="button"
                    tabIndex={0}
                    onClick={featuredOpportunityMeta.onCardClick}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        featuredOpportunityMeta.onCardClick();
                      }
                    }}
                  >
                    <CardContent className="pt-3 pb-3 px-4 md:px-4 space-y-2">
                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5 w-fit rounded-md bg-background/70 dark:bg-white/10">
                        Featured Opportunity
                      </Badge>
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            {configuredFeaturedOpportunity.kind === "saveUsdst" ? (
                              <div className="w-12 h-12 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 flex items-center justify-center shrink-0">
                                <PiggyBank className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                              </div>
                            ) : configuredFeaturedOpportunity.kind === "vault" ? (
                              <img
                                src={stratoVaultLogo}
                                alt="STRATO Vault"
                                className="w-12 h-12 rounded-full object-cover shrink-0"
                              />
                            ) : configuredFeaturedOpportunity.kind === "lending" ? (
                              <div className="w-12 h-12 rounded-full bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
                                <CircleArrowDown className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                              </div>
                            ) : (
                              <TokenPairIcon pool={configuredFeaturedOpportunity.pool} size="lg" />
                            )}
                            <div className="min-w-0">
                              <h3 className="text-2xl md:text-[26px] leading-none font-semibold tracking-tight">{featuredOpportunityMeta.title}</h3>
                              <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">
                                {featuredOpportunityMeta.subtitle}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="text-left md:text-right shrink-0">
                          <p className="text-xs md:text-sm uppercase tracking-wide text-muted-foreground">
                            {featuredOpportunityMeta.rateLabel}
                          </p>
                          <p className={`text-2xl md:text-[32px] leading-none font-semibold ${featuredOpportunityApy.className}`}>
                            {featuredOpportunityApy.label === "-" ? "-" : featuredOpportunityApy.label}
                          </p>
                          <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">
                            TVL ${formatUsd(featuredOpportunityMeta.tvl)}
                          </p>
                          <div className="mt-1 flex items-center gap-2 md:justify-end">
                            <Badge variant="secondary" className="text-[10px] px-2 py-0.5 rounded-md">{featuredOpportunityMeta.badge}</Badge>
                            <Badge className="text-[10px] px-2 py-0.5 rounded-md bg-amber-600 hover:bg-amber-600 text-white">Featured</Badge>
                          </div>
                        </div>
                      </div>
                      <Button
                        className="w-full h-8 rounded-lg bg-amber-600 hover:bg-amber-600 text-white font-medium"
                        variant="default"
                        onClick={(e) => {
                          e.stopPropagation();
                          featuredOpportunityMeta.onActionClick();
                        }}
                        disabled={
                          (featuredOpportunityMeta.actionLabel === "Deposit" && guestMode) ||
                          (configuredFeaturedOpportunity.kind === "pool" &&
                            (isPoolPaused(configuredFeaturedOpportunity.pool) || Boolean((configuredFeaturedOpportunity.pool as any).isDisabled)))
                        }
                      >
                        {featuredOpportunityMeta.actionLabel === "View" ? "Deposit" : featuredOpportunityMeta.actionLabel}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}

                <div>
                <Card
                  className="border border-blue-500/40 dark:border-blue-400/35 bg-gradient-to-br from-[#f8fbff] to-[#edf3ff] dark:from-[#0f1a33] dark:to-[#111c3a] shadow-sm cursor-pointer h-full"
                  role="button"
                  tabIndex={0}
                  onClick={topOpportunityMeta.onCardClick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      topOpportunityMeta.onCardClick();
                    }
                  }}
                >
                  <CardContent className="pt-3 pb-3 px-4 md:px-4 space-y-2">
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5 w-fit rounded-md bg-background/70 dark:bg-white/10">
                      Top Opportunity
                    </Badge>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          {topOpportunity.kind === "saveUsdst" ? (
                          <div className="w-12 h-12 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 flex items-center justify-center shrink-0">
                            <PiggyBank className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                          ) : topOpportunity.kind === "vault" ? (
                            <img
                              src={stratoVaultLogo}
                              alt="STRATO Vault"
                            className="w-12 h-12 rounded-full object-cover shrink-0"
                            />
                          ) : topOpportunity.kind === "lending" ? (
                          <div className="w-12 h-12 rounded-full bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
                            <CircleArrowDown className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                          ) : (
                            <TokenPairIcon pool={topOpportunity.pool} size="lg" />
                          )}
                          <div className="min-w-0">
                          <h3 className="text-2xl md:text-[26px] leading-none font-semibold tracking-tight">{topOpportunityMeta.title}</h3>
                          <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">
                              {topOpportunityMeta.subtitle}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="text-left md:text-right shrink-0">
                        <p className="text-xs md:text-sm uppercase tracking-wide text-muted-foreground">
                          {topOpportunityMeta.rateLabel}
                        </p>
                      <p className={`text-2xl md:text-[32px] leading-none font-semibold ${topOpportunityApy.className}`}>
                          {topOpportunityApy.label === "-" ? "-" : topOpportunityApy.label}
                        </p>
                      <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">
                          TVL ${formatUsd(topOpportunityMeta.tvl)}
                        </p>
                      <div className="mt-1 flex items-center gap-2 md:justify-end">
                          <Badge variant="secondary" className="text-[10px] px-2 py-0.5 rounded-md">{topOpportunityMeta.badge}</Badge>
                          <Badge className="text-[10px] px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-600 text-white">Top Ranked</Badge>
                        </div>
                      </div>
                    </div>
                    <Button
                    className="w-full h-8 rounded-lg bg-blue-600 hover:bg-blue-600 text-white font-medium"
                      variant="default"
                      onClick={(e) => {
                        e.stopPropagation();
                        topOpportunityMeta.onActionClick();
                      }}
                      disabled={
                        (topOpportunityMeta.actionLabel === "Deposit" && guestMode) ||
                        (topOpportunity.kind === "pool" &&
                          (isPoolPaused(topOpportunity.pool) || Boolean((topOpportunity.pool as any).isDisabled)))
                      }
                    >
                      {topOpportunityMeta.actionLabel}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>

          <section className="mt-2 space-y-3 border-t border-border/60 pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-lg font-semibold">All Opportunities</h2>
              <div className="w-full sm:w-auto overflow-x-auto">
                <div className="inline-flex min-w-max items-center gap-2 pr-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveFilter("all")}
                    className={`h-9 rounded-full px-6 text-base font-medium transition-all ${
                      activeFilter === "all"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200"
                        : "bg-transparent text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                    }`}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveFilter("vaults")}
                    className={`h-9 rounded-full px-6 text-base font-medium transition-all ${
                      activeFilter === "vaults"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200"
                        : "bg-transparent text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                    }`}
                  >
                    Vaults
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveFilter("pools")}
                    className={`h-9 rounded-full px-6 text-base font-medium transition-all ${
                      activeFilter === "pools"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200"
                        : "bg-transparent text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                    }`}
                  >
                    Pools
                  </Button>
                </div>
              </div>
            </div>

            <Card className="border border-border/70 overflow-hidden">
              <CardContent className="p-0">
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1260px]">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border/50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Opportunity</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Yield</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Rewards</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">TVL</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Your Position</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allOpportunities.map((opportunity) => {
                        if (opportunity.kind === "saveUsdst") {
                          const saveUsdstApyDisplay = formatApyDisplay(saveUsdstEstimatedApy);
                          return (
                            <tr
                              key="save-usdst"
                              className="border-b border-border/40 cursor-pointer hover:bg-muted/20"
                              role="button"
                              tabIndex={0}
                              onClick={() => navigate("/dashboard/earn-save")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate("/dashboard/earn-save");
                                }
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-emerald-500/15 dark:bg-emerald-400/15 flex items-center justify-center shrink-0">
                                    <PiggyBank className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                  </div>
                                  <p className="font-medium truncate">Savings Vault</p>
                                  <Badge variant="secondary" className="text-[10px]">Savings Vault</Badge>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <p className={`text-sm font-semibold ${saveUsdstApyDisplay.className}`}>
                                  {saveUsdstApyDisplay.label}
                                </p>
                                <p className="text-xs text-muted-foreground">APY</p>
                              </td>
                              <td className="px-4 py-3">
                                {saveUsdstRewardMeta.pointsLabel !== "-" ? (
                                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Star className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium text-foreground">{saveUsdstRewardMeta.pointsLabel}</span>
                                    {saveUsdstRewardMeta.featured && (
                                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Boosted</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground">--</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  ${formatUsd(saveUsdstTvl)}
                                </p>
                                <p className="text-xs text-muted-foreground">TVL</p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>
                                <p className="text-xs text-muted-foreground">Your Position</p>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Savings Vault
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    className="h-9 min-w-[108px] justify-center"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate("/dashboard/earn-save");
                                    }}
                                    disabled={guestMode}
                                  >
                                    <CircleArrowDown className="h-4 w-4 mr-1 shrink-0" />
                                    Deposit
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        if (opportunity.kind === "vault") {
                          return (
                            <tr
                              key="vault"
                              className="border-b border-border/50 cursor-pointer hover:bg-muted/20"
                              role="button"
                              tabIndex={0}
                              onClick={() => navigate("/dashboard/earn-vault")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate("/dashboard/earn-vault");
                                }
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <img
                                    src={stratoVaultLogo}
                                    alt="STRATO Vault"
                                    className="w-8 h-8 rounded-full object-cover shrink-0"
                                  />
                                  <p className="font-medium truncate">Diversified Vault</p>
                                  <Badge variant="secondary" className="text-[10px]">Diversified Vault</Badge>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <p className={`text-sm font-semibold ${vaultAlpha.className}`}>
                                  {vaultAlpha.label}
                                </p>
                                <p className="text-xs text-muted-foreground">APY</p>
                              </td>
                              <td className="px-4 py-3">
                                {vaultRewardMeta.pointsLabel !== "-" ? (
                                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                    <Star className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium text-foreground">{vaultRewardMeta.pointsLabel}</span>
                                    {vaultRewardMeta.featured && (
                                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Boosted</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground">--</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">${formatUsd(vaultState.totalEquity)}</p>
                                <p className="text-xs text-muted-foreground">TVL</p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>
                                <p className="text-xs text-muted-foreground">Your Position</p>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Diversified Vault
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-3">
                                  {vaultRewardMeta.pointsLabel !== "-" && (
                                    <div className="hidden" />
                                  )}
                                  <Button
                                    className="h-9 min-w-[108px] justify-center"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleVaultDepositClick();
                                    }}
                                    disabled={guestMode}
                                  >
                                    <CircleArrowDown className="h-4 w-4 mr-1 shrink-0" />
                                    Deposit
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        if (opportunity.kind === "lending") {
                          return (
                            <tr
                              key="lending"
                              className="border-b border-border/40 cursor-pointer hover:bg-muted/20"
                              role="button"
                              tabIndex={0}
                              onClick={() => navigate("/dashboard/earn-lending")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate("/dashboard/earn-lending");
                                }
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
                                    <CircleArrowDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                  </div>
                                  <p className="font-medium truncate">USDST Lending Pool</p>
                                  <Badge variant="secondary" className="text-[10px]">Lending</Badge>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  {formatApyDisplay(liquidityInfo?.supplyAPY).label}
                                </p>
                                <p className="text-xs text-muted-foreground">APY</p>
                              </td>
                              <td className="px-4 py-3">
                                {lendingRewardMeta.pointsLabel !== "-" ? (
                                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                    <Star className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium text-foreground">{lendingRewardMeta.pointsLabel}</span>
                                    {lendingRewardMeta.featured && (
                                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Boosted</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground">--</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  {loadingLiquidity || !liquidityInfo?.totalUSDSTSupplied
                                    ? "$0.00"
                                    : `$${formatUsd(liquidityInfo.totalUSDSTSupplied.toString())}`}
                                </p>
                                <p className="text-xs text-muted-foreground">TVL</p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>
                                <p className="text-xs text-muted-foreground">Your Position</p>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Lending pool
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  {lendingRewardMeta.pointsLabel !== "-" && (
                                    <div className="hidden" />
                                  )}
                                  <Button
                                    className="h-9 min-w-[108px] justify-center"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleLendingDepositClick();
                                    }}
                                    disabled={guestMode}
                                  >
                                    <CircleArrowDown className="h-4 w-4 mr-1 shrink-0" />
                                    Deposit
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        const { pool } = opportunity;
                        const poolRewardMeta = getRewardMeta(pool.lpToken?.address);
                        return (
                          <Fragment key={pool.address}>
                            <tr
                              className="border-b border-border/40 last:border-b-0 cursor-pointer hover:bg-muted/20"
                              role="button"
                              tabIndex={0}
                              onClick={() => navigateToPoolDetails(pool)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigateToPoolDetails(pool);
                                }
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <TokenPairIcon pool={pool} />
                                  <p className="font-medium truncate">{pool.poolName}</p>
                                  <Badge variant="secondary" className="text-[10px]">Pool</Badge>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  {formatApyDisplay(pool.apy).label}
                                </p>
                                <p className="text-xs text-muted-foreground">APY</p>
                              </td>
                              <td className="px-4 py-3">
                                {poolRewardMeta.pointsLabel !== "-" ? (
                                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                    <Star className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium text-foreground">{poolRewardMeta.pointsLabel}</span>
                                    {poolRewardMeta.featured && (
                                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Boosted</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground">--</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">${formatUsd(pool.totalLiquidityUSD)}</p>
                                <p className="text-xs text-muted-foreground">TVL</p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>
                                <p className="text-xs text-muted-foreground">Your Position</p>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Swap fees
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  {poolRewardMeta.pointsLabel !== "-" && (
                                    <div className="hidden" />
                                  )}
                                  <Button
                                    className="h-9 min-w-[108px] justify-center"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePoolDeposit(pool);
                                    }}
                                    disabled={guestMode || isPoolPaused(pool) || Boolean((pool as any).isDisabled)}
                                  >
                                    <CircleArrowDown className="h-4 w-4 mr-1 shrink-0" />
                                    Deposit
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}

                      {(activeFilter === "pools" && !poolsLoading && sortedPools.length === 0) && (
                        <tr>
                          <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={7}>
                            No pool opportunities available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>

        </main>
      </div>

      <MobileBottomNav />

      <Dialog open={isLendingDepositModalOpen} onOpenChange={(open) => (!open ? closeLendingDepositModal() : setIsLendingDepositModalOpen(true))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deposit to USDST Lending Pool</DialogTitle>
            <DialogDescription>Enter amount and confirm your deposit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Input
                type="number"
                placeholder="0.00"
                value={lendingDepositAmount}
                onChange={(e) => setLendingDepositAmount(e.target.value)}
                className="pl-16 h-11"
                disabled={!isLoggedIn || isLendingSubmitting}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">USDST</span>
            </div>
            <div className="text-sm text-muted-foreground">
              <button
                type="button"
                className="text-blue-600 hover:underline mr-2"
                onClick={() => {
                  const availableWei = safeBigInt(liquidityInfo?.supplyable?.userBalance);
                  const feeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
                  const maxWei = availableWei > feeWei ? availableWei - feeWei : 0n;
                  setLendingDepositAmount(formatMaxAmount(maxWei));
                }}
              >
                Max
              </button>
              Available: {formatBalance(liquidityInfo?.supplyable?.userBalance || "0", undefined, 18, 2)} USDST
            </div>
            <div className="text-sm text-muted-foreground">Transaction Fee: {LENDING_DEPOSIT_FEE} USDST</div>
            {rewardsEnabled && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="earn-lending-modal-stake"
                  checked={stakeLendingRewards}
                  onCheckedChange={(checked) => setStakeLendingRewards(checked === true)}
                />
                <label htmlFor="earn-lending-modal-stake" className="text-sm font-medium">
                  Stake my mUSDST to earn rewards
                </label>
              </div>
            )}
            <Button className="w-full h-11" onClick={handleLendingDepositSubmit} disabled={!isLendingDepositValid || isLendingSubmitting || !isLoggedIn}>
              {isLendingSubmitting ? "Processing..." : "Deposit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <LiquidityDepositModal
        isOpen={isPoolDepositModalOpen}
        onClose={() => setIsPoolDepositModalOpen(false)}
        selectedPool={selectedPool}
        onDepositSuccess={handlePoolActionSuccess}
        operationInProgressRef={operationInProgressRef}
        usdstBalance={usdstBalance}
        voucherBalance={voucherBalance}
      />

      <LiquidityWithdrawModal
        isOpen={isPoolWithdrawModalOpen}
        onClose={() => setIsPoolWithdrawModalOpen(false)}
        selectedPool={selectedPool}
        onWithdrawSuccess={handlePoolActionSuccess}
        operationInProgressRef={operationInProgressRef}
        usdstBalance={usdstBalance}
        voucherBalance={voucherBalance}
      />

      <VaultDepositModal
        isOpen={isVaultDepositModalOpen}
        onClose={() => setIsVaultDepositModalOpen(false)}
        onSuccess={handleVaultDepositSuccess}
      />
    </div>
  );
};

export default Earn;
