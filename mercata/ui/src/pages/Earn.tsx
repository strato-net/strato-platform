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
import { useYieldVaultContext } from "@/hooks/useYieldVaultContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { useEarnContext } from "@/context/EarnContext";
import { useRewardsActivities } from "@/hooks/useRewardsActivities";
import { useToast } from "@/hooks/use-toast";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidityDepositModal from "@/components/dashboard/LiquidityDepositModal";
import LiquidityWithdrawModal from "@/components/dashboard/LiquidityWithdrawModal";
import VaultDepositModal from "@/components/vault/VaultDepositModal";
import { api } from "@/lib/axios";
import type { Pool } from "@/interface";
import { formatUnits } from "ethers";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { CircleArrowDown, PiggyBank, ShieldCheck, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import stratoVaultLogo from "@/assets/strato-vault-logo.png";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { BestApyInfoTooltip } from "@/components/earn/BestApyInfoTooltip";
import { EarnApyInfo, buildNativeRewardsApyInfo, findBestEarnApyInfo, findPoolEarnApyInfo, findVaultEarnApyInfo } from "@/utils/earnUtils";
import {
  mUsdstAddress,
  LENDING_DEPOSIT_FEE,
  rewardsEnabled,
} from "@/lib/constants";

const WAD = BigInt(10) ** BigInt(18);
const TOP_OPPORTUNITY_MIN_POOL_TVL = 100000n * WAD;

type StakingEarnInfo = {
  tokenSymbol: string;
  stratoTokenAddress: string;
  totalRewardableStake: string;
  totalRewardableStakeUsd: string;
  userTotalStake: string;
  userTotalStakeUsd: string;
  validators: Array<{
    active: boolean;
    estimatedApy: string;
  }>;
};

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

/** Numeric USD string from WAD (same as formatUsd) or "--" if vault has assets but no oracle TVL. */
const formatYieldVaultTvlUsd = (
  vault: { deployed?: boolean; tvlUsd?: string; totalAssets?: string } | null | undefined
): string => {
  if (!vault?.deployed) return "--";
  const tvl = safeBigInt(vault.tvlUsd);
  const ta = safeBigInt(vault.totalAssets);
  if (ta > 0n && tvl <= 0n) return "--";
  return formatUsd(vault.tvlUsd || "0");
};

/**
 * Carry vault user position in USD from API: underlying claim from shares (ERC4626 virtual offset) × assetPriceWad / 10^decimals.
 */
const formatYieldVaultPositionUsd = (
  uData: {
    userShares?: string;
    redeemableAssets?: string;
    positionUsd?: string;
    assetPriceWad?: string;
  } | null | undefined,
  vData: { deployed?: boolean } | null | undefined
): string => {
  if (!vData?.deployed) return "--";
  const shares = safeBigInt(uData?.userShares);
  if (shares <= 0n) return `$${formatUsd("0")}`;
  const price = safeBigInt(uData?.assetPriceWad);
  const pos = safeBigInt(uData?.positionUsd ?? "0");
  const redeemable = safeBigInt(uData?.redeemableAssets ?? "0");
  if (redeemable > 0n && price <= 0n && pos <= 0n) return "--";
  return `$${formatUsd(uData?.positionUsd || "0")}`;
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

  if (apy > 0) {
    return {
      label: `+${apy.toFixed(2)}%`,
      className: "text-foreground",
    };
  }

  if (apy < 0) {
    return {
      label: `${apy.toFixed(2)}%`,
      className: "text-foreground",
    };
  }

  return { label: "0.00%", className: "text-foreground" };
};

/** Carry vault APYs are 0 until yield strategies ship — show em dash instead of 0.00%. */
const formatCarryVaultApyDisplayForLive = (
  apy: string | number | undefined
): { label: string; className: string } => {
  const n = Number(apy);
  const isZeroOrUnset =
    apy === null ||
    apy === undefined ||
    apy === "" ||
    apy === "-" ||
    !Number.isFinite(n) ||
    n === 0;
  if (isZeroOrUnset) {
    return { label: "—", className: "text-foreground" };
  }
  return formatApyDisplay(apy);
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

const YIELD_VAULTS = [
  {
    key: "eth-carry",
    name: "ETH Carry Vault",
    subtitle: "ERC-4626 carry vault for ETH deposits",
    asset: "ETH",
    badge: "Carry Vault",
    iconBg: "bg-indigo-500/15 dark:bg-indigo-400/15",
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  {
    key: "wbtc-carry",
    name: "wBTC Carry Vault",
    subtitle: "ERC-4626 carry vault for wBTC deposits",
    asset: "wBTC",
    badge: "Carry Vault",
    iconBg: "bg-orange-500/15 dark:bg-orange-400/15",
    iconColor: "text-orange-600 dark:text-orange-400",
  },
  {
    key: "usdc-yield",
    name: "USDC Yield Vault",
    subtitle: "ERC-4626 yield vault for USDC deposits",
    asset: "USDC",
    badge: "Yield Vault",
    iconBg: "bg-emerald-500/15 dark:bg-emerald-400/15",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
] as const;

const Earn = () => {
  type OpportunityRow =
    | { kind: "saveUsdst"; apySortValue: number }
    | { kind: "vault"; apySortValue: number }
    | { kind: "lending"; apySortValue: number }
    | { kind: "staking"; apySortValue: number }
    | { kind: "pool"; apySortValue: number; pool: Pool }
    | { kind: "yieldVault"; apySortValue: number; vaultIndex: number };

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
  const [stakingInfo, setStakingInfo] = useState<StakingEarnInfo | null>(null);
  const operationInProgressRef = useRef(false);

  const { vaultState, refreshVault } = useVaultContext();
  const { pools, fetchPools, poolsLoading } = useSwapContext();
  const { liquidityInfo, loadingLiquidity, refreshLiquidity, depositLiquidity } = useLendingContext();
  const { saveUsdstInfo } = useSaveUsdstContext();
  const { vaults: yieldVaults, userVaults: yieldUserVaults, loading: yieldVaultsLoading } =
    useYieldVaultContext();
  const { earningAssets, usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { tokenApys, tokenApysLoaded } = useEarnContext();
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
    const endpoint = isLoggedIn ? "/staking/info" : "/staking/info/public";

    api.get<StakingEarnInfo>(endpoint)
      .then(({ data }) => {
        if (!cancelled) setStakingInfo(data);
      })
      .catch(() => {
        if (!cancelled) setStakingInfo(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

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

  const saveUsdstTvl = useMemo(() => {
    if (saveUsdstInfo?.deployed && saveUsdstInfo.projectedTvlUsd) {
      return saveUsdstInfo.projectedTvlUsd;
    }

    if (saveUsdstInfo?.deployed && saveUsdstInfo.tvlUsd) {
      return saveUsdstInfo.tvlUsd;
    }

    if (saveUsdstInfo?.deployed && saveUsdstInfo.projectedPricingAssets) {
      return saveUsdstInfo.projectedPricingAssets;
    }

    if (saveUsdstInfo?.deployed && saveUsdstInfo.pricingAssets) {
      return saveUsdstInfo.pricingAssets;
    }

    if (saveUsdstInfo?.deployed && saveUsdstInfo.totalAssets) {
      return saveUsdstInfo.totalAssets;
    }

    return saveUsdstRewardsActivity?.totalStakeUsd || "0";
  }, [saveUsdstInfo, saveUsdstRewardsActivity]);

  const saveUsdstApyInfo = useMemo<EarnApyInfo | null>(
    () => findBestEarnApyInfo(tokenApys, saveUsdstInfo?.vaultAddress || saveUsdstAsset?.address),
    [saveUsdstAsset?.address, saveUsdstInfo?.vaultAddress, tokenApys]
  );

  const vaultEarnApyInfo = useMemo(() => findVaultEarnApyInfo(tokenApys), [tokenApys]);
  const lendingEarnApyInfo = useMemo(() => findBestEarnApyInfo(tokenApys, mUsdstAddress), [tokenApys]);

  // Combined (native + CATA rewards) APY per carry yield vault, keyed by cfg.key.
  // Backend publishes entries keyed by vault address via addCarryVaultApys.
  const yieldVaultApyInfos = useMemo<Record<string, EarnApyInfo | null>>(() => {
    const out: Record<string, EarnApyInfo | null> = {};
    for (const cfg of YIELD_VAULTS) {
      const vaultAddress = yieldVaults[cfg.key]?.vaultAddress;
      out[cfg.key] = findBestEarnApyInfo(tokenApys, vaultAddress);
    }
    return out;
  }, [tokenApys, yieldVaults]);
  const getYieldVaultDisplayApyRaw = (key: string): string | undefined => {
    const info = yieldVaultApyInfos[key];
    if (info) return info.total.toFixed(2);
    // Fallback to the native-only APY from yield-vault context in case the
    // backend hasn't surfaced combined entries yet on this network.
    return yieldVaults[key]?.apy;
  };
  const getPoolEarnApyInfo = (pool: Pool) => findBestEarnApyInfo(tokenApys, pool.lpToken?.address);
  const getPoolDisplayApy = (pool: Pool) => {
    const info = getPoolEarnApyInfo(pool);
    return info ? info.total.toFixed(2) : undefined;
  };
  const saveUsdstDisplayApyRaw = saveUsdstApyInfo?.total.toFixed(2);
  const lendingDisplayApyRaw = lendingEarnApyInfo?.total.toFixed(2);
  const stakingBestApyRaw = useMemo(() => {
    const values = (stakingInfo?.validators || [])
      .filter((validator) => validator.active)
      .map((validator) => Number(validator.estimatedApy))
      .filter((apy) => Number.isFinite(apy) && apy > 0);

    return values.length ? Math.max(...values).toFixed(2) : undefined;
  }, [stakingInfo?.validators]);
  // Combined staking APY (best validator native + platform rewards), matching
  // the Stake page and portfolio convention.
  const stakingApyInfo = useMemo<EarnApyInfo | null>(() => {
    const native = Number(stakingBestApyRaw) || 0;
    const strato = normalizeAddress(stakingInfo?.stratoTokenAddress || "");
    const rewardsEntry = strato
      ? tokenApys
          .find((entry) => normalizeAddress(entry.token) === strato)
          ?.apys.find((item) => item.source === "rewards" && item.meta === "staking")
      : undefined;
    const rewards = Number(rewardsEntry?.apy) || 0;
    const breakdown = [
      native > 0 ? { label: "Native APY", apy: native.toFixed(2) } : null,
      rewards > 0 ? { label: "Rewards APY", apy: rewards.toFixed(2) } : null,
    ].filter((item): item is { label: string; apy: string } => item !== null);
    if (breakdown.length === 0) return null;
    return { total: native + rewards, source: "staking", breakdown };
  }, [stakingBestApyRaw, stakingInfo?.stratoTokenAddress, tokenApys]);
  const stakingDisplayApyRaw = stakingApyInfo ? stakingApyInfo.total.toFixed(2) : stakingBestApyRaw;
  // USD TVL once the STRATO oracle price is set; token units until then.
  const stakingTotalStakedLabel = !stakingInfo
    ? "--"
    : safeBigInt(stakingInfo.totalRewardableStakeUsd) > 0n
      ? `$${formatUsd(stakingInfo.totalRewardableStakeUsd)}`
      : `${formatTokenAmount(stakingInfo.totalRewardableStake)} ${stakingInfo.tokenSymbol || "STRATO"}`;

  const getOpportunityTvl = (opportunity: OpportunityRow): bigint => {
    if (opportunity.kind === "saveUsdst") return safeBigInt(saveUsdstTvl);
    if (opportunity.kind === "vault") return safeBigInt(vaultState.totalEquity);
    if (opportunity.kind === "lending") return safeBigInt(liquidityInfo?.totalUSDSTSupplied?.toString());
    if (opportunity.kind === "staking") return safeBigInt(stakingInfo?.totalRewardableStakeUsd);
    if (opportunity.kind === "yieldVault") {
      const vData = yieldVaults[YIELD_VAULTS[opportunity.vaultIndex].key];
      return safeBigInt(vData?.tvlUsd);
    }
    return safeBigInt(opportunity.pool.totalLiquidityUSD);
  };

  const getOpportunitySimplicityRank = (opportunity: OpportunityRow): number => {
    if (opportunity.kind === "saveUsdst") return 0;
    if (opportunity.kind === "vault") return 1;
    if (opportunity.kind === "yieldVault") return 2;
    if (opportunity.kind === "staking") return 3;
    if (opportunity.kind === "lending") return 4;
    return 5;
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
    if (a.kind === "yieldVault" && b.kind === "yieldVault") {
      return a.vaultIndex === b.vaultIndex;
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

    if (opportunity.kind === "staking") {
      if (!stakingInfo) return "--";
      // USD once the STRATO oracle price is set; token units until then.
      return safeBigInt(stakingInfo.userTotalStakeUsd) > 0n || safeBigInt(stakingInfo.userTotalStake) === 0n
        ? `$${formatUsd(stakingInfo.userTotalStakeUsd)}`
        : `${formatTokenAmount(stakingInfo.userTotalStake)} ${stakingInfo.tokenSymbol || "STRATO"}`;
    }

    if (opportunity.kind === "yieldVault") {
      const key = YIELD_VAULTS[opportunity.vaultIndex].key;
      const vData = yieldVaults[key];
      const uData = yieldUserVaults[key];
      if (!vData?.deployed) return "--";
      if (yieldVaultsLoading && isLoggedIn && !uData) return "...";
      return formatYieldVaultPositionUsd(uData, vData);
    }

    const lpBalance = safeBigInt(opportunity.pool.lpToken?.totalBalance);
    const lpPrice = safeBigInt(opportunity.pool.lpToken?.price);
    const depositedUsd = lpPrice > 0n ? (lpBalance * lpPrice) / WAD : 0n;
    return `$${formatUsd(depositedUsd.toString())}`;
  };

  const rewardActivityByContract = useMemo(() => {
    const map = new Map<string, { emissionRate: bigint; totalStakeUsd: string | null }>();
    for (const activity of rewardsActivities || []) {
      const contract = activity.sourceContract?.toLowerCase();
      if (!contract) continue;
      try {
        map.set(contract, {
          emissionRate: BigInt(activity.emissionRate || "0"),
          totalStakeUsd: activity.totalStakeUsd ?? null,
        });
      } catch {
        map.set(contract, { emissionRate: 0n, totalStakeUsd: activity.totalStakeUsd ?? null });
      }
    }
    return map;
  }, [rewardsActivities]);

  const getRewardMeta = (contractAddress?: string) => {
    const contract = contractAddress?.toLowerCase();
    if (!contract) return { earnsRewards: false };
    const activity = rewardActivityByContract.get(contract);
    return { earnsRewards: Boolean(activity && activity.emissionRate > 0n) };
  };

  const vaultRewardMeta = getRewardMeta(vaultState.shareTokenAddress);
  const lendingRewardMeta = getRewardMeta(mUsdstAddress);
  const saveUsdstRewardMeta = getRewardMeta(saveUsdstRewardsActivity?.sourceContract || saveUsdstAsset?.address);
  const vaultRewardActivity = rewardActivityByContract.get(vaultState.shareTokenAddress?.toLowerCase() || "");
  const resolvedVaultApyInfo = useMemo(
    () =>
      vaultEarnApyInfo ||
      buildNativeRewardsApyInfo(
        vaultState.alpha,
        vaultRewardActivity?.emissionRate ? vaultRewardActivity.emissionRate.toString() : null,
        vaultRewardActivity?.totalStakeUsd ?? vaultState.totalEquity ?? null,
        "vault"
      ),
    [
      vaultEarnApyInfo,
      vaultRewardActivity?.emissionRate,
      vaultRewardActivity?.totalStakeUsd,
      vaultState.alpha,
      vaultState.totalEquity,
    ]
  );
  const vaultDisplayApyRaw = resolvedVaultApyInfo
    ? resolvedVaultApyInfo.total.toFixed(2)
    : vaultState.alpha;
  const allOpportunities = useMemo<OpportunityRow[]>(() => {
    const rows: OpportunityRow[] = [];

    if (activeFilter === "all" || activeFilter === "vaults") {
      rows.push({ kind: "saveUsdst", apySortValue: parseApy(saveUsdstDisplayApyRaw) });
      rows.push({ kind: "vault", apySortValue: parseApy(vaultDisplayApyRaw) });
      for (let i = 0; i < YIELD_VAULTS.length; i++) {
        const cfg = YIELD_VAULTS[i];
        const yv = yieldVaults[cfg.key];
        rows.push({
          kind: "yieldVault",
          apySortValue: yv?.deployed ? parseApy(getYieldVaultDisplayApyRaw(cfg.key)) : Number.NEGATIVE_INFINITY,
          vaultIndex: i,
        });
      }
    }

    if (activeFilter === "all" || activeFilter === "pools") {
      if (activeFilter === "all") {
        rows.push({ kind: "staking", apySortValue: parseApy(stakingDisplayApyRaw) });
      }
      rows.push({ kind: "lending", apySortValue: parseApy(lendingDisplayApyRaw) });
      for (const pool of sortedPools) {
        rows.push({ kind: "pool", apySortValue: parseApy(getPoolDisplayApy(pool)), pool });
      }
    }

    return rows.sort(compareOpportunities);
  }, [activeFilter, lendingDisplayApyRaw, saveUsdstDisplayApyRaw, saveUsdstTvl, sortedPools, stakingDisplayApyRaw, tokenApys, tokenApysLoaded, vaultDisplayApyRaw, vaultState.totalEquity, liquidityInfo?.totalUSDSTSupplied, yieldVaults, yieldVaultApyInfos]);

  const vaultAlpha = formatApyDisplay(vaultDisplayApyRaw);
  const rankedTopCandidates = useMemo<OpportunityRow[]>(() => {
    const candidates: OpportunityRow[] = [
      { kind: "saveUsdst", apySortValue: parseApy(saveUsdstDisplayApyRaw) },
      { kind: "vault", apySortValue: parseApy(vaultDisplayApyRaw) },
      ...YIELD_VAULTS.map((v, i) => ({
        kind: "yieldVault" as const,
        apySortValue: yieldVaults[v.key]?.deployed ? parseApy(getYieldVaultDisplayApyRaw(v.key)) : Number.NEGATIVE_INFINITY,
        vaultIndex: i,
      })),
      { kind: "lending", apySortValue: parseApy(lendingDisplayApyRaw) },
      { kind: "staking", apySortValue: parseApy(stakingDisplayApyRaw) },
      ...sortedPools.map((pool) => ({
        kind: "pool" as const,
        apySortValue: parseApy(getPoolDisplayApy(pool)),
        pool,
      })),
    ];
    const rankedCandidates = [...candidates].sort(compareOpportunities);
    return rankedCandidates.filter(isEligibleForTopOpportunity).length > 0
      ? rankedCandidates.filter(isEligibleForTopOpportunity)
      : rankedCandidates;
  }, [lendingDisplayApyRaw, liquidityInfo?.totalUSDSTSupplied, saveUsdstDisplayApyRaw, saveUsdstTvl, sortedPools, stakingDisplayApyRaw, tokenApys, tokenApysLoaded, vaultDisplayApyRaw, vaultState.totalEquity, yieldVaults, yieldVaultApyInfos]);
  const getOpportunityMeta = (opportunity: OpportunityRow) => {
    if (opportunity.kind === "saveUsdst") {
      return {
        title: "Savings Vault",
        subtitle: "Stable USD savings with yield plus rewards",
        apyRaw: saveUsdstDisplayApyRaw,
        tvl: saveUsdstTvl,
        badge: "Savings Vault",
        rateLabel: "Best Available APY",
        actionLabel: "Deposit",
        onCardClick: () => navigate("/dashboard/earn-save"),
        onActionClick: () => navigate("/dashboard/earn-save"),
      };
    }

    if (opportunity.kind === "vault") {
      return {
        title: "Diversified Vault",
        subtitle: "Diversified real assets: gold, silver, ETH, BTC, stables - actively managed",
        apyRaw: vaultDisplayApyRaw,
        tvl: vaultState.totalEquity,
        badge: "Diversified Vault",
        rateLabel: "Best Available APY",
        actionLabel: "Deposit",
        onCardClick: () => navigate("/dashboard/earn-vault"),
        onActionClick: () => handleVaultDepositClick(),
      };
    }

    if (opportunity.kind === "yieldVault") {
      const cfg = YIELD_VAULTS[opportunity.vaultIndex];
      const vaultData = yieldVaults[cfg.key] ?? null;
      const isLive = Boolean(vaultData?.deployed);
      return {
        title: cfg.name,
        subtitle: cfg.subtitle,
        apyRaw: isLive ? getYieldVaultDisplayApyRaw(cfg.key) : undefined,
        tvl: isLive ? (vaultData?.tvlUsd || "0") : "0",
        badge: cfg.badge,
        rateLabel: "Best Available APY",
        actionLabel: isLive ? "Deposit" : "Coming Soon",
        onCardClick: () => navigate(`/dashboard/earn-yield-vault?vault=${cfg.key}`),
        onActionClick: () => navigate(`/dashboard/earn-yield-vault?vault=${cfg.key}`),
      };
    }

    if (opportunity.kind === "lending") {
      return {
        title: "USDST Lending Pool",
        subtitle: "Earn yield by supplying USDST liquidity",
        apyRaw: lendingDisplayApyRaw,
        tvl: liquidityInfo?.totalUSDSTSupplied?.toString() || "0",
        badge: "Lending",
        rateLabel: "Best Available APY",
        actionLabel: "Deposit",
        onCardClick: () => navigate("/dashboard/earn-lending"),
        onActionClick: () => handleLendingDepositClick(),
      };
    }

    if (opportunity.kind === "staking") {
      return {
        title: "Stake STRATO",
        subtitle: "Delegate STRATO to approved validators",
        apyRaw: stakingDisplayApyRaw,
        tvl: stakingInfo?.totalRewardableStakeUsd || "0",
        badge: "Staking",
        rateLabel: "Best Available APY",
        actionLabel: "Stake",
        onCardClick: () => navigate("/dashboard/earn-staking"),
        onActionClick: () => navigate("/dashboard/earn-staking"),
      };
    }

    const pool = opportunity.pool;
    return {
      title: pool.poolName,
      subtitle: `Earn fees on ${pool.poolName.replace(" Pool", "")} swaps`,
      apyRaw: getPoolDisplayApy(pool),
      tvl: pool.totalLiquidityUSD,
      badge: "Pool",
      rateLabel: "Best Available APY",
      actionLabel: "Deposit",
      onCardClick: () => navigateToPoolDetails(pool),
      onActionClick: () => handlePoolDeposit(pool),
      pool,
    };
  };
  const getOpportunityApyInfo = (opportunity: OpportunityRow): EarnApyInfo | null => {
    if (opportunity.kind === "saveUsdst") return saveUsdstApyInfo;
    if (opportunity.kind === "vault") return resolvedVaultApyInfo;
    if (opportunity.kind === "yieldVault") {
      return yieldVaultApyInfos[YIELD_VAULTS[opportunity.vaultIndex].key] ?? null;
    }
    if (opportunity.kind === "lending") return lendingEarnApyInfo;
    if (opportunity.kind === "staking") return stakingApyInfo;
    return getPoolEarnApyInfo(opportunity.pool);
  };

  const configuredFeaturedOpportunity = useMemo<OpportunityRow | null>(() => {
    const key = featuredOpportunityKey.trim().toLowerCase();
    if (!key) return null;

    if (key === "save-usdst" || key === "saveusdst") {
      return { kind: "saveUsdst", apySortValue: parseApy(saveUsdstDisplayApyRaw) };
    }

    if (key === "vault") {
      return { kind: "vault", apySortValue: parseApy(vaultDisplayApyRaw) };
    }

    if (key === "lending") {
      return { kind: "lending", apySortValue: parseApy(lendingDisplayApyRaw) };
    }

    if (key === "staking" || key === "strato-staking") {
      return { kind: "staking", apySortValue: parseApy(stakingDisplayApyRaw) };
    }

    const yieldVaultIdx = YIELD_VAULTS.findIndex((v) => v.key === key);
    if (yieldVaultIdx !== -1) {
      return { kind: "yieldVault", apySortValue: Number.NEGATIVE_INFINITY, vaultIndex: yieldVaultIdx };
    }

    if (key.startsWith("pool:")) {
      const targetAddress = normalizeAddress(key.slice(5));
      const pool = sortedPools.find((candidate) => normalizeAddress(candidate.address) === targetAddress);
      if (pool) {
        return { kind: "pool", apySortValue: parseApy(getPoolDisplayApy(pool)), pool };
      }
    }

    return null;
  }, [
    featuredOpportunityKey,
    lendingDisplayApyRaw,
    saveUsdstDisplayApyRaw,
    sortedPools,
    stakingDisplayApyRaw,
    tokenApys,
    tokenApysLoaded,
    vaultDisplayApyRaw,
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

  const topOpportunityMeta = useMemo(() => getOpportunityMeta(topOpportunity), [topOpportunity, lendingDisplayApyRaw, saveUsdstDisplayApyRaw, saveUsdstTvl, stakingDisplayApyRaw, stakingInfo?.totalRewardableStake, tokenApys, tokenApysLoaded, vaultDisplayApyRaw, vaultState.totalEquity, liquidityInfo?.totalUSDSTSupplied, navigate]);
  const topOpportunityApyInfo = useMemo(() => getOpportunityApyInfo(topOpportunity), [topOpportunity, saveUsdstApyInfo, resolvedVaultApyInfo, lendingEarnApyInfo, stakingApyInfo, tokenApys]);
  const topOpportunityApy = useMemo(() => {
    if (topOpportunity.kind === "yieldVault") {
      const cfg = YIELD_VAULTS[topOpportunity.vaultIndex];
      const vd = yieldVaults[cfg.key];
      if (!vd?.deployed) return formatApyDisplay(undefined);
      return formatCarryVaultApyDisplayForLive(getYieldVaultDisplayApyRaw(cfg.key));
    }
    return formatApyDisplay(topOpportunityMeta.apyRaw);
  }, [topOpportunity, topOpportunityMeta.apyRaw, yieldVaults, yieldVaultApyInfos]);
  const featuredOpportunityMeta = useMemo(
    () => (configuredFeaturedOpportunity ? getOpportunityMeta(configuredFeaturedOpportunity) : null),
    [
      configuredFeaturedOpportunity,
      saveUsdstDisplayApyRaw,
      saveUsdstTvl,
      tokenApys,
      tokenApysLoaded,
      vaultDisplayApyRaw,
      vaultState.totalEquity,
      lendingDisplayApyRaw,
      liquidityInfo?.totalUSDSTSupplied,
      stakingDisplayApyRaw,
      stakingInfo?.totalRewardableStake,
      navigate,
    ]
  );
  const featuredOpportunityApyInfo = useMemo(
    () => (configuredFeaturedOpportunity ? getOpportunityApyInfo(configuredFeaturedOpportunity) : null),
    [configuredFeaturedOpportunity, saveUsdstApyInfo, resolvedVaultApyInfo, lendingEarnApyInfo, stakingApyInfo, tokenApys]
  );
  const featuredOpportunityApy = useMemo(() => {
    if (!configuredFeaturedOpportunity || !featuredOpportunityMeta) {
      return formatApyDisplay(featuredOpportunityMeta?.apyRaw);
    }
    if (configuredFeaturedOpportunity.kind === "yieldVault") {
      const cfg = YIELD_VAULTS[configuredFeaturedOpportunity.vaultIndex];
      const vd = yieldVaults[cfg.key];
      if (!vd?.deployed) return formatApyDisplay(undefined);
      return formatCarryVaultApyDisplayForLive(getYieldVaultDisplayApyRaw(cfg.key));
    }
    return formatApyDisplay(featuredOpportunityMeta.apyRaw);
  }, [configuredFeaturedOpportunity, featuredOpportunityMeta, yieldVaults, yieldVaultApyInfos]);

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
                    className="h-full cursor-pointer rounded-[22px] border border-amber-300/70 bg-gradient-to-br from-[#fff9ef] via-[#fff7ea] to-[#fff2dc] shadow-[0_6px_18px_rgba(217,119,6,0.07)] dark:border-amber-400/35 dark:from-[#24190a] dark:via-[#2a1c0c] dark:to-[#2b1d0c]"
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
                    <CardContent className="space-y-4 px-4 pb-4 pt-4 md:px-5 md:pb-5 md:pt-5">
                      <p className="text-sm font-semibold text-foreground/90">
                        Featured Opportunity
                      </p>
                      <div className="flex items-start gap-3.5">
                        {configuredFeaturedOpportunity.kind === "saveUsdst" ? (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 dark:bg-emerald-400/15">
                            <PiggyBank className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                          </div>
                        ) : configuredFeaturedOpportunity.kind === "vault" ? (
                          <img
                            src={stratoVaultLogo}
                            alt="STRATO Vault"
                            className="h-12 w-12 shrink-0 rounded-full object-cover"
                          />
                        ) : configuredFeaturedOpportunity.kind === "yieldVault" ? (
                          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${YIELD_VAULTS[configuredFeaturedOpportunity.vaultIndex].iconBg}`}>
                            <TrendingUp className={`h-5 w-5 ${YIELD_VAULTS[configuredFeaturedOpportunity.vaultIndex].iconColor}`} />
                          </div>
                        ) : configuredFeaturedOpportunity.kind === "lending" ? (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-500/15 dark:bg-blue-400/15">
                            <CircleArrowDown className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                          </div>
                        ) : configuredFeaturedOpportunity.kind === "staking" ? (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 dark:bg-cyan-400/15">
                            <ShieldCheck className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                          </div>
                        ) : (
                          <TokenPairIcon pool={configuredFeaturedOpportunity.pool} size="lg" />
                        )}
                        <div className="min-w-0 pt-1">
                          <h3 className="text-[26px] leading-[1.08] font-semibold tracking-tight md:text-[30px]">
                            {featuredOpportunityMeta.title}
                          </h3>
                          <p className="mt-1 max-w-[28rem] text-[13px] leading-[1.35] text-muted-foreground md:text-sm">
                            {featuredOpportunityMeta.subtitle}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl bg-white/45 px-3 py-2.5 dark:bg-white/5">
                        <p className="text-[11px] font-medium text-muted-foreground md:text-xs inline-flex items-center gap-1">
                          {featuredOpportunityMeta.rateLabel}
                          {featuredOpportunityMeta.rateLabel === "Best Available APY" && <BestApyInfoTooltip />}
                        </p>
                        <EarnApyTooltip info={featuredOpportunityApyInfo}>
                          <span className={`text-[22px] leading-none font-semibold md:text-[28px] ${featuredOpportunityApy.className} cursor-default`}>
                            {featuredOpportunityApy.label === "-" ? "-" : featuredOpportunityApy.label}
                          </span>
                        </EarnApyTooltip>
                        <p className="text-[11px] font-medium text-muted-foreground md:text-xs">
                          TVL
                        </p>
                        <p className="text-sm font-medium text-foreground/80 md:text-sm">
                          {configuredFeaturedOpportunity.kind === "staking"
                            ? stakingTotalStakedLabel
                            : configuredFeaturedOpportunity.kind === "yieldVault"
                              ? (() => {
                                const vd =
                                  yieldVaults[
                                  YIELD_VAULTS[configuredFeaturedOpportunity.vaultIndex].key
                                  ];
                                const s = formatYieldVaultTvlUsd(vd);
                                return s === "--" ? "--" : `$${s}`;
                              })()
                              : `$${formatUsd(featuredOpportunityMeta.tvl)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="rounded-md border-0 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-none dark:bg-white/10">
                          {featuredOpportunityMeta.badge}
                        </Badge>
                        <Badge className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-600">
                          Featured
                        </Badge>
                      </div>
                      <Button
                        className="h-10 w-full rounded-xl bg-amber-600 text-[15px] font-semibold text-white hover:bg-amber-600"
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
                  className="h-full cursor-pointer rounded-[22px] border border-blue-300/70 bg-gradient-to-br from-[#f8fbff] via-[#f4f8ff] to-[#edf3ff] shadow-[0_6px_18px_rgba(37,99,235,0.07)] dark:border-blue-400/35 dark:from-[#0f1a33] dark:via-[#101a35] dark:to-[#111c3a]"
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
                  <CardContent className="space-y-4 px-4 pb-4 pt-4 md:px-5 md:pb-5 md:pt-5">
                    <p className="text-sm font-semibold text-foreground/90">
                      Top Opportunity
                    </p>
                    <div className="flex items-start gap-3.5">
                      {topOpportunity.kind === "saveUsdst" ? (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 dark:bg-emerald-400/15">
                          <PiggyBank className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                      ) : topOpportunity.kind === "vault" ? (
                        <img
                          src={stratoVaultLogo}
                          alt="STRATO Vault"
                          className="h-12 w-12 shrink-0 rounded-full object-cover"
                        />
                      ) : topOpportunity.kind === "yieldVault" ? (
                        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${YIELD_VAULTS[topOpportunity.vaultIndex].iconBg}`}>
                          <TrendingUp className={`h-5 w-5 ${YIELD_VAULTS[topOpportunity.vaultIndex].iconColor}`} />
                        </div>
                      ) : topOpportunity.kind === "lending" ? (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-500/15 dark:bg-blue-400/15">
                          <CircleArrowDown className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                      ) : topOpportunity.kind === "staking" ? (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 dark:bg-cyan-400/15">
                          <ShieldCheck className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                        </div>
                      ) : (
                        <TokenPairIcon pool={topOpportunity.pool} size="lg" />
                      )}
                      <div className="min-w-0 pt-1">
                        <h3 className="text-[26px] leading-[1.08] font-semibold tracking-tight md:text-[30px]">
                          {topOpportunityMeta.title}
                        </h3>
                        <p className="mt-1 max-w-[28rem] text-[13px] leading-[1.35] text-muted-foreground md:text-sm">
                          {topOpportunityMeta.subtitle}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl bg-white/45 px-3 py-2.5 dark:bg-white/5">
                      <p className="text-[11px] font-medium text-muted-foreground md:text-xs inline-flex items-center gap-1">
                        {topOpportunityMeta.rateLabel}
                        {topOpportunityMeta.rateLabel === "Best Available APY" && <BestApyInfoTooltip />}
                      </p>
                      <EarnApyTooltip info={topOpportunityApyInfo}>
                        <span className={`text-[22px] leading-none font-semibold md:text-[28px] ${topOpportunityApy.className} cursor-default`}>
                          {topOpportunityApy.label === "-" ? "-" : topOpportunityApy.label}
                        </span>
                      </EarnApyTooltip>
                      <p className="text-[11px] font-medium text-muted-foreground md:text-xs">
                        TVL
                      </p>
                      <p className="text-sm font-medium text-foreground/80 md:text-sm">
                        {topOpportunity.kind === "yieldVault"
                          ? (() => {
                            const vd = yieldVaults[YIELD_VAULTS[topOpportunity.vaultIndex].key];
                            const s = formatYieldVaultTvlUsd(vd);
                            return s === "--" ? "--" : `$${s}`;
                          })()
                          : topOpportunity.kind === "staking"
                            ? stakingTotalStakedLabel
                          : `$${formatUsd(topOpportunityMeta.tvl)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-md border-0 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-none dark:bg-white/10">
                        {topOpportunityMeta.badge}
                      </Badge>
                      <Badge className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600">
                        Top Ranked
                      </Badge>
                    </div>
                    <Button
                      className="h-10 w-full rounded-xl bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-600"
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
                    className={`h-9 rounded-full px-6 text-base font-medium transition-all ${activeFilter === "all"
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
                    className={`h-9 rounded-full px-6 text-base font-medium transition-all ${activeFilter === "vaults"
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
                    className={`h-9 rounded-full px-6 text-base font-medium transition-all ${activeFilter === "pools"
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
                  <table className="w-full min-w-[1140px]">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border/50">
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">Opportunity</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">
                          <span className="inline-flex items-center gap-1">
                            Best Available APY
                            <BestApyInfoTooltip />
                          </span>
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">TVL</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">Your Position</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground tracking-wide">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground tracking-wide">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allOpportunities.map((opportunity) => {
                        if (opportunity.kind === "saveUsdst") {
                          const saveUsdstApyDisplay = formatApyDisplay(saveUsdstDisplayApyRaw);
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
                                  {saveUsdstRewardMeta.earnsRewards && (
                                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Rewards</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <EarnApyTooltip info={saveUsdstApyInfo}>
                                  <p className={`text-sm font-semibold ${saveUsdstApyDisplay.className} cursor-default`}>
                                    {saveUsdstApyDisplay.label}
                                  </p>
                                </EarnApyTooltip>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  ${formatUsd(saveUsdstTvl)}
                                </p>                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>                              </td>
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
                                  {vaultRewardMeta.earnsRewards && (
                                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Rewards</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <EarnApyTooltip info={resolvedVaultApyInfo}>
                                  <p className={`text-sm font-semibold ${vaultAlpha.className} cursor-default`}>
                                    {vaultAlpha.label}
                                  </p>
                                </EarnApyTooltip>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">${formatUsd(vaultState.totalEquity)}</p>                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Diversified Vault
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-3">
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

                        if (opportunity.kind === "yieldVault") {
                          const cfg = YIELD_VAULTS[opportunity.vaultIndex];
                          const yvData = yieldVaults[cfg.key] ?? null;
                          const yvLive = Boolean(yvData?.deployed);
                          const yvApyInfo = yieldVaultApyInfos[cfg.key];
                          const yvApyDisplay = yvLive
                            ? formatCarryVaultApyDisplayForLive(getYieldVaultDisplayApyRaw(cfg.key))
                            : { label: "--", className: "text-muted-foreground" };
                          return (
                            <tr
                              key={cfg.key}
                              className={`border-b border-border/40 cursor-pointer hover:bg-muted/20 ${yvLive ? "" : "opacity-75"}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => navigate(`/dashboard/earn-yield-vault?vault=${cfg.key}`)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate(`/dashboard/earn-yield-vault?vault=${cfg.key}`);
                                }
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className={`w-8 h-8 rounded-full ${cfg.iconBg} flex items-center justify-center shrink-0`}>
                                    <TrendingUp className={`h-4 w-4 ${cfg.iconColor}`} />
                                  </div>
                                  <p className="font-medium truncate">{cfg.name}</p>
                                  <Badge variant="secondary" className="text-[10px]">{cfg.badge}</Badge>
                                  {!yvLive && (
                                    <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400">Coming Soon</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <EarnApyTooltip info={yvApyInfo}>
                                  <p className={`text-sm font-semibold cursor-default ${yvApyDisplay.className}`}>
                                    {yvApyDisplay.label}
                                  </p>
                                </EarnApyTooltip>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  {yvLive
                                    ? (() => {
                                      const s = formatYieldVaultTvlUsd(yvData);
                                      return s === "--" ? "--" : `$${s}`;
                                    })()
                                    : "--"}
                                </p>                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                {cfg.badge}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end">
                                  <Button
                                    className="h-9 min-w-[108px] justify-center"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/dashboard/earn-yield-vault?vault=${cfg.key}`);
                                    }}
                                    disabled={guestMode && yvLive}
                                    variant={yvLive ? "default" : "outline"}
                                  >
                                    {yvLive ? (
                                      <>
                                        <CircleArrowDown className="h-4 w-4 mr-1 shrink-0" />
                                        Deposit
                                      </>
                                    ) : (
                                      "Coming Soon"
                                    )}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        if (opportunity.kind === "staking") {
                          const stakingApyDisplay = formatApyDisplay(stakingDisplayApyRaw);
                          return (
                            <tr
                              key="staking"
                              className="border-b border-border/40 cursor-pointer hover:bg-muted/20"
                              role="button"
                              tabIndex={0}
                              onClick={() => navigate("/dashboard/earn-staking")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate("/dashboard/earn-staking");
                                }
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-cyan-500/15 dark:bg-cyan-400/15 flex items-center justify-center shrink-0">
                                    <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                                  </div>
                                  <p className="font-medium truncate">Stake STRATO</p>
                                  <Badge variant="secondary" className="text-[10px]">Staking</Badge>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <EarnApyTooltip info={stakingApyInfo}>
                                  <p className={`text-sm font-semibold cursor-default ${stakingApyDisplay.className}`}>
                                    {stakingApyDisplay.label}
                                  </p>
                                </EarnApyTooltip>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{stakingTotalStakedLabel}</p>                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Protocol staking
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    className="h-9 min-w-[108px] justify-center"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate("/dashboard/earn-staking");
                                    }}
                                  >
                                    <ShieldCheck className="h-4 w-4 mr-1 shrink-0" />
                                    Stake
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
                                  {lendingRewardMeta.earnsRewards && (
                                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Rewards</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <EarnApyTooltip info={lendingEarnApyInfo}>
                                  <p className="text-sm font-semibold cursor-default">
                                    {formatApyDisplay(lendingDisplayApyRaw).label}
                                  </p>
                                </EarnApyTooltip>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">
                                  {loadingLiquidity || !liquidityInfo?.totalUSDSTSupplied
                                    ? "$0.00"
                                    : `$${formatUsd(liquidityInfo.totalUSDSTSupplied.toString())}`}
                                </p>                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Lending pool
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
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
                        const poolApyInfo = getPoolEarnApyInfo(pool);
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
                                  {poolRewardMeta.earnsRewards && (
                                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">Rewards</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <EarnApyTooltip info={poolApyInfo}>
                                  <p className="text-sm font-semibold cursor-default">
                                    {formatApyDisplay(getPoolDisplayApy(pool)).label}
                                  </p>
                                </EarnApyTooltip>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">${formatUsd(pool.totalLiquidityUSD)}</p>                              </td>
                              <td className="px-4 py-3">
                                <p className="text-sm font-semibold">{getOpportunityPositionValue(opportunity)}</p>                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">
                                Swap fees
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-2">
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
                          <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={6}>
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
