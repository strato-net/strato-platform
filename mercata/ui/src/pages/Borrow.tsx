import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "ethers";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CirclePlus,
  Coins,
  HandCoins,
  Landmark,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useLendingContext } from "@/context/LendingContext";
import { useOracleContext } from "@/context/OracleContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidationAlertBanner from "@/components/ui/LiquidationAlertBanner";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import RepayForm from "@/components/borrow/RepayForm";
import { CollateralData } from "@/interface";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { api } from "@/lib/axios";
import {
  calculateAfterBorrowHealthFactor,
  calculateAvailableToBorrowUSD,
  calculateHFSliderExtrema,
  getRiskLabel,
  recommendCollateralToSupply,
} from "@/utils/lendingUtils";

type RoutePreviewApiResponse = {
  feasible: boolean;
  shortfall: string;
  rates: {
    lendingApr: number;
    cdpApr: number;
    blendedApr: number;
  };
  health: {
    cdpCollateralRatio: number;
    cdpEffectiveHealthFactor: number;
    lendingHealthFactor: number;
    unifiedHealthFactor: number;
  };
  position: {
    projectedLtvPercent: number;
    liquidationDropPercent: number;
    liquidationHealthFactor: number;
    liquidationPriceUSD: number;
    liquidationAssetSymbol: string;
  };
  constraints: {
    lendingCapacity?: string;
    cdpCapacity?: string;
    cdpCapacityFromExistingCollateral?: string;
    cdpCapacityFromFreshCollateral?: string;
    totalCapacity: string;
  };
  routing?: {
    selectionReason?: string;
    selectedLendingAmount?: string;
    selectedCdpAmount?: string;
    cdpFromFreshCollateral?: string;
    cdpFromExistingCollateral?: string;
  };
  lendingAllocations: Array<{
    asset: string;
    symbol: string;
    decimals: number;
    supplyAmount: string;
    collateralValueUSD: string;
  }>;
  cdpAllocations: Array<{
    asset: string;
    symbol: string;
    decimals: number;
    depositAmount: string;
    depositCollateralValueUSD?: string;
    mintAmount: string;
    apr: number;
    collateralRatio: number;
    effectiveHealthFactor: number;
    collateralValueUSD: string;
  }>;
  split: {
    lendingAmount: string;
    cdpAmount: string;
    mechanisms?: number;
  };
};

type ExecuteBorrowRouteResponse = {
  status: "success" | "partial_or_failed";
  error?: string;
  steps?: Array<{ step: string; status: "pending" | "completed" | "failed"; error?: string }>;
  execution?: {
    lendingBorrowed?: string;
    cdpMinted?: string;
    totalBorrowed?: string;
    failedStep?: string | null;
  };
};

type CdpVault = {
  asset: string;
  symbol: string;
  collateralAmount: string;
  collateralAmountDecimals: number;
  collateralValueUSD: string;
  debtAmount: string;
  collateralizationRatio: number;
  healthFactor: number;
};

type CollateralRow = {
  key: string;
  address: string;
  symbol: string;
  source: "Lending Collateral" | "CDP Vault";
  sourceSubLabel?: string;
  balanceText: string;
  amountText: string;
  usedText: string;
  muted: boolean;
  manual: boolean;
  inputValue: string;
  availableText: string;
  asset?: CollateralData;
};

type SourceLoadStatus = "idle" | "loading" | "success" | "error";

const Borrow = () => {
  const { userAddress, isLoggedIn } = useUser();
  const { fetchUsdstBalance, usdstBalance, voucherBalance } = useTokenContext();
  const { toast } = useToast();
  const {
    loans,
    collateralInfo,
    liquidityInfo,
    refreshLoans,
    refreshCollateral,
    repayLoan,
    repayAll,
  } = useLendingContext();
  const { getPrice } = useOracleContext();

  const [borrowInput, setBorrowInput] = useState("");
  const [selectedBorrowPreset, setSelectedBorrowPreset] = useState<number | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [repayLoading, setRepayLoading] = useState(false);
  const [inlineBorrowError, setInlineBorrowError] = useState("");
  const [inlineRepayError, setInlineRepayError] = useState("");
  const [autoAllocate, setAutoAllocate] = useState(true);
  const [targetHealthFactor, setTargetHealthFactor] = useState(2.1);
  const [showDetails, setShowDetails] = useState(true);
  const [routePreviewData, setRoutePreviewData] = useState<RoutePreviewApiResponse | null>(null);
  const [routePreviewLoading, setRoutePreviewLoading] = useState(false);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showRepayPanel, setShowRepayPanel] = useState(false);
  const [cdpVaults, setCdpVaults] = useState<CdpVault[]>([]);
  const [lendingCollateralStatus, setLendingCollateralStatus] = useState<SourceLoadStatus>("idle");
  const [cdpVaultsStatus, setCdpVaultsStatus] = useState<SourceLoadStatus>("idle");
  const { userRewards } = useRewardsUserInfo();

  const guestMode = !isLoggedIn;
  type CustomCollateralEntry = { source: "wei"; wei: bigint } | { source: "usd"; usd: string };
  type CustomCdpEntry = { usd: string };
  const normalizedBorrowInput = borrowInput.replace(/,/g, "").trim();
  const requestedBorrow = Number(normalizedBorrowInput || "0");
  const requestedBorrowWei = safeParseUnits(normalizedBorrowInput || "0", 18);
  const requestedBorrowUsdDisplay = useMemo(() => {
    if (requestedBorrowWei <= 0n) return "0.00";

    const borrowableAssetAddress = liquidityInfo?.supplyable?.address;
    const oraclePrice = borrowableAssetAddress ? getPrice(borrowableAssetAddress) : null;
    const fallbackTokenPrice = liquidityInfo?.supplyable?.price?.toString();
    const priceRaw = oraclePrice ?? fallbackTokenPrice ?? "1000000000000000000";

    let priceWei: bigint;
    try {
      priceWei = BigInt(priceRaw);
      if (priceWei <= 0n) priceWei = 10n ** 18n;
    } catch {
      priceWei = 10n ** 18n;
    }

    const usdValueWei = (requestedBorrowWei * priceWei) / (10n ** 18n);
    const usdValue = Number(formatUnits(usdValueWei, 18));

    return usdValue.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [
    requestedBorrowWei,
    liquidityInfo?.supplyable?.address,
    liquidityInfo?.supplyable?.price,
    getPrice,
  ]);
  useEffect(() => {
    document.title = "Borrow Assets | STRATO";
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setCdpVaults([]);
      setLendingCollateralStatus("idle");
      setCdpVaultsStatus("idle");
      return;
    }
    let cancelled = false;
    const refreshData = async () => {
      setLendingCollateralStatus("loading");
      setCdpVaultsStatus("loading");

      refreshLoans().catch((error) => {
        console.error("Error refreshing loan data:", error);
      });
      fetchUsdstBalance().catch((error) => {
        console.error("Error refreshing USDST balance:", error);
      });

      refreshCollateral()
        .then(() => {
          if (!cancelled) setLendingCollateralStatus("success");
        })
        .catch((error) => {
          if (!cancelled) setLendingCollateralStatus("error");
          console.error("Error refreshing lending collateral data:", error);
        });

      api
        .get<CdpVault[]>("/cdp/vaults")
        .then((vaultsRes) => {
          if (cancelled) return;
          setCdpVaults(Array.isArray(vaultsRes.data) ? vaultsRes.data : []);
          setCdpVaultsStatus("success");
        })
        .catch((error) => {
          if (cancelled) return;
          setCdpVaults([]);
          setCdpVaultsStatus("error");
          console.error("Error refreshing CDP vault data:", error);
        });
    };
    refreshData();
    return () => {
      cancelled = true;
    };
  }, [userAddress, isLoggedIn, refreshLoans, refreshCollateral, fetchUsdstBalance]);

  const potentialCollateral = useMemo(() => {
    const map = new Map<CollateralData, bigint>();
    if (!collateralInfo) return map;
    for (const collateral of collateralInfo) {
      const balance = BigInt(collateral.userBalance || "0");
      if (balance > 0n) map.set(collateral, balance);
    }
    return map;
  }, [collateralInfo]);

  const [customCollateralEntries, setCustomCollateralEntries] = useState<Map<string, CustomCollateralEntry>>(new Map());
  const [manualCollateralInputErrors, setManualCollateralInputErrors] = useState<Map<string, string>>(new Map());
  const [customCdpEntries, setCustomCdpEntries] = useState<Map<string, CustomCdpEntry>>(new Map());
  const [manualCdpInputErrors, setManualCdpInputErrors] = useState<Map<string, string>>(new Map());

  const sliderExtrema = useMemo(() => {
    return calculateHFSliderExtrema(loans, collateralInfo);
  }, [loans, collateralInfo]);

  const availableToBorrow = useMemo(() => {
    if (!loans || !collateralInfo || collateralInfo.length === 0) return 0n;
    return calculateAvailableToBorrowUSD(loans, targetHealthFactor, potentialCollateral);
  }, [loans, collateralInfo, targetHealthFactor, potentialCollateral]);

  const recommendedCollateral = useMemo(() => {
    if (!loans || !collateralInfo || requestedBorrow <= 0) {
      return new Map<CollateralData, bigint>();
    }
    return recommendCollateralToSupply(loans, targetHealthFactor, requestedBorrow, [...collateralInfo]);
  }, [loans, collateralInfo, requestedBorrow, targetHealthFactor]);

  const getManualCollateralAmount = (asset: CollateralData, entry?: CustomCollateralEntry): bigint => {
    if (!entry) return 0n;
    const balance = BigInt(asset.userBalance || "0");
    if (entry.source === "wei") {
      return entry.wei > balance ? balance : entry.wei;
    }
    const usdInput = entry.usd.trim();
    if (!usdInput) return 0n;
    const price = BigInt(asset.assetPrice || "0");
    if (price <= 0n) return 0n;
    const decimals = BigInt(asset.customDecimals ?? 18);
    const usdWei = safeParseUnits(usdInput, 18);
    if (usdWei <= 0n) return 0n;
    const computedAmount = (usdWei * (10n ** decimals)) / price;
    return computedAmount > balance ? balance : computedAmount;
  };

  const manualCollateral = useMemo(() => {
    const map = new Map<CollateralData, bigint>();
    if (autoAllocate) return map;
    for (const collateral of potentialCollateral.keys()) {
      const entry = customCollateralEntries.get(collateral.address);
      const amount = getManualCollateralAmount(collateral, entry);
      if (amount > 0n) {
        map.set(collateral, amount);
      }
    }
    return map;
  }, [autoAllocate, potentialCollateral, customCollateralEntries]);

  const selectedCollateral = useMemo(() => {
    return autoAllocate ? recommendedCollateral : manualCollateral;
  }, [autoAllocate, recommendedCollateral, manualCollateral]);

  const totalCollateralUsedWei = useMemo(() => {
    if (routePreviewData) {
      const parseCollateralValue = (value?: string) => {
        try {
          return BigInt(value || "0");
        } catch {
          return 0n;
        }
      };
      const lendingUsed = (routePreviewData.lendingAllocations || []).reduce(
        (sum, item) => sum + parseCollateralValue(item.collateralValueUSD),
        0n
      );
      const cdpUsed = (routePreviewData.cdpAllocations || []).reduce(
        (sum, item) => sum + parseCollateralValue(item.depositCollateralValueUSD),
        0n
      );
      return lendingUsed + cdpUsed;
    }
    return Array.from(selectedCollateral.entries()).reduce((sum, [asset, amount]) => {
      const decimals = BigInt(asset.customDecimals ?? 18);
      const price = BigInt(asset.assetPrice || "0");
      return sum + (amount * price) / (10n ** decimals);
    }, 0n);
  }, [selectedCollateral, routePreviewData]);

  const totalBorrowRoutedWei = useMemo(() => {
    if (!routePreviewData) return 0n;
    const parseWei = (value?: string) => {
      try {
        return BigInt(value || "0");
      } catch {
        return 0n;
      }
    };
    return parseWei(routePreviewData.split?.lendingAmount) + parseWei(routePreviewData.split?.cdpAmount);
  }, [routePreviewData]);

  const handleAutoAllocateToggle = () => {
    setAutoAllocate((prev) => {
      const next = !prev;
      if (!next) {
        const initialEntries = new Map<string, CustomCollateralEntry>();
        for (const collateral of potentialCollateral.keys()) {
          const recommendedAmount = recommendedCollateral.get(collateral);
          if (recommendedAmount && recommendedAmount > 0n) {
            initialEntries.set(collateral.address, { source: "wei", wei: recommendedAmount });
          } else {
            initialEntries.set(collateral.address, { source: "usd", usd: "0.00" });
          }
        }
        setCustomCollateralEntries(initialEntries);
        setManualCollateralInputErrors(new Map());
        const initialCdpEntries = new Map<string, CustomCdpEntry>();
        for (const vault of cdpVaults) {
          const maxUsd = Number(formatUnits(BigInt(vault.collateralValueUSD || "0"), 18));
          initialCdpEntries.set(vault.asset, { usd: maxUsd.toFixed(2) });
        }
        setCustomCdpEntries(initialCdpEntries);
        setManualCdpInputErrors(new Map());
      } else {
        setCustomCollateralEntries(new Map());
        setManualCollateralInputErrors(new Map());
        setCustomCdpEntries(new Map());
        setManualCdpInputErrors(new Map());
      }
      return next;
    });
  };

  const handleCustomCollateralValueChange = (address: string, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    const asset = Array.from(potentialCollateral.keys()).find((item) => item.address === address);
    const maxUsd = asset ? Number(formatUnits(BigInt(asset.userBalanceValue || "0"), 18)) : 0;
    let nextValue = value;
    let errorText = "";
    if (value !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > maxUsd) {
        nextValue = maxUsd.toFixed(2);
        errorText = `Max available is $${maxUsd.toFixed(2)}`;
      }
    }
    setCustomCollateralEntries((prev) => {
      const next = new Map(prev);
      next.set(address, { source: "usd", usd: nextValue });
      return next;
    });
    setManualCollateralInputErrors((prev) => {
      const next = new Map(prev);
      if (errorText) {
        next.set(address, errorText);
      } else {
        next.delete(address);
      }
      return next;
    });
  };

  const handleFillMaxCollateral = (asset: CollateralData) => {
    setCustomCollateralEntries((prev) => {
      const next = new Map(prev);
      next.set(asset.address, { source: "wei", wei: BigInt(asset.userBalance || "0") });
      return next;
    });
    setManualCollateralInputErrors((prev) => {
      const next = new Map(prev);
      next.delete(asset.address);
      return next;
    });
  };

  const handleCustomCdpValueChange = (assetAddress: string, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    const vault = cdpVaults.find((item) => item.asset.toLowerCase() === assetAddress.toLowerCase());
    const maxUsd = vault ? Number(formatUnits(BigInt(vault.collateralValueUSD || "0"), 18)) : 0;
    let nextValue = value;
    let errorText = "";
    if (value !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > maxUsd) {
        nextValue = maxUsd.toFixed(2);
        errorText = `Max available is $${maxUsd.toFixed(2)}`;
      }
    }
    setCustomCdpEntries((prev) => {
      const next = new Map(prev);
      next.set(assetAddress, { usd: nextValue });
      return next;
    });
    setManualCdpInputErrors((prev) => {
      const next = new Map(prev);
      if (errorText) {
        next.set(assetAddress, errorText);
      } else {
        next.delete(assetAddress);
      }
      return next;
    });
  };

  const handleFillMaxCdpCollateral = (vault: CdpVault) => {
    const maxUsd = Number(formatUnits(BigInt(vault.collateralValueUSD || "0"), 18));
    setCustomCdpEntries((prev) => {
      const next = new Map(prev);
      next.set(vault.asset, { usd: maxUsd.toFixed(2) });
      return next;
    });
    setManualCdpInputErrors((prev) => {
      const next = new Map(prev);
      next.delete(vault.asset);
      return next;
    });
  };

  const collateralRows = useMemo(() => {
    const rowsFromAmounts = (entries: Array<[CollateralData, bigint]>): CollateralRow[] => {
      return entries
        .filter(([, amount]) => amount > 0n)
        .slice(0, 3)
        .map(([asset, amount]) => {
          const decimals = asset.customDecimals ?? 18;
          const tokenAmount = Number(formatUnits(amount, decimals));
          const usdValue = Number((amount * BigInt(asset.assetPrice || "0")) / (10n ** BigInt(decimals))) / 1e18;
          return {
            key: `lending-auto-${asset.address}`,
            address: asset.address,
            symbol: asset._symbol,
            source: "Lending Collateral" as const,
            balanceText: `Balance: ${formatBalance(asset.userBalance || "0", undefined, decimals, 2, 2)} · ${formatBalance(asset.userBalanceValue || "0", undefined, 18, 2, 2, true)}`,
            amountText: `${tokenAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${asset._symbol}`,
            usedText: `${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} used`,
            muted: false,
            manual: false,
            inputValue: "",
            availableText: "",
            asset,
          };
        });
    };

    const existingCdpVaultRows: CollateralRow[] = cdpVaults.map((vault) => {
      const decimals = vault.collateralAmountDecimals || 18;
      const tokenAmount = Number(formatUnits(BigInt(vault.collateralAmount || "0"), decimals));
      const usdValue = Number(formatUnits(BigInt(vault.collateralValueUSD || "0"), 18));
      return {
        key: `cdp-existing-${vault.asset}`,
        address: vault.asset,
        symbol: vault.symbol,
        source: "CDP Vault",
        sourceSubLabel: "Existing Vault Position",
        balanceText: `Debt: ${formatBalance(vault.debtAmount || "0", "USDST", 18, 2, 2)}`,
        amountText: `${tokenAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${vault.symbol}`,
        usedText: `${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in vault`,
        muted: false,
        manual: false,
        inputValue: "",
        availableText: "",
      };
    });
    const existingLendingRows: CollateralRow[] = (collateralInfo || [])
      .filter((asset) => BigInt(asset.collateralizedAmount || "0") > 0n)
      .map((asset) => {
        const decimals = asset.customDecimals ?? 18;
        const amount = BigInt(asset.collateralizedAmount || "0");
        const amountNumber = Number(formatUnits(amount, decimals));
        const usdValue = Number(formatUnits(BigInt(asset.collateralizedAmountValue || "0"), 18));
        return {
          key: `lending-existing-${asset.address}`,
          address: asset.address,
          symbol: asset._symbol,
          source: "Lending Collateral",
          sourceSubLabel: "Existing Lending Position",
          balanceText: `Wallet: ${formatBalance(asset.userBalance || "0", undefined, decimals, 2, 2)} · ${formatBalance(asset.userBalanceValue || "0", undefined, 18, 2, 2, true)}`,
          amountText: `${amountNumber.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${asset._symbol}`,
          usedText: `${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} already collateralized`,
          muted: false,
          manual: false,
          inputValue: "",
          availableText: "",
          asset,
        };
      });

    if (autoAllocate) {
      if (isLoggedIn && requestedBorrowWei > 0n && routePreviewLoading && !routePreviewData) {
        return [...existingLendingRows, ...existingCdpVaultRows];
      }
      if (routePreviewData) {
        const lendingRows: CollateralRow[] = (routePreviewData.lendingAllocations || [])
          .filter((item) => BigInt(item.supplyAmount || "0") > 0n)
          .map((item) => {
            const supplyAmount = BigInt(item.supplyAmount || "0");
            const usdValue = Number(formatUnits(BigInt(item.collateralValueUSD || "0"), 18));
            const matchingAsset = Array.from(potentialCollateral.keys()).find((asset) => asset.address === item.asset);
            const balanceText = matchingAsset
              ? `Balance: ${formatBalance(matchingAsset.userBalance || "0", undefined, matchingAsset.customDecimals ?? 18, 2, 2)} · ${formatBalance(matchingAsset.userBalanceValue || "0", undefined, 18, 2, 2, true)}`
              : "Balance sourced from wallet collateral";
            return {
              key: `lending-route-${item.asset}`,
              address: item.asset,
              symbol: item.symbol,
              source: "Lending Collateral",
              sourceSubLabel: "Allocated by Health Factor",
              balanceText,
              amountText: `${Number(formatUnits(supplyAmount, item.decimals || 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${item.symbol}`,
              usedText: `${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} used`,
              muted: false,
              manual: false,
              inputValue: "",
              availableText: "",
            };
          });
        const lendingAmountWei = (() => {
          try {
            return BigInt(routePreviewData.split?.lendingAmount || "0");
          } catch {
            return 0n;
          }
        })();
        if (lendingRows.length === 0 && lendingAmountWei > 0n) {
          lendingRows.push({
            key: "lending-route-existing-capacity",
            address: "lending-existing",
            symbol: "USDST",
            source: "Lending Collateral",
            sourceSubLabel: "Allocated by Health Factor (Existing Position)",
            balanceText: `Borrow route: ${Number(formatUnits(lendingAmountWei, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST`,
            amountText: "No new supply required",
            usedText: "Using existing lending collateral capacity",
            muted: false,
            manual: false,
            inputValue: "",
            availableText: "",
          });
        }

        const cdpRouteRows: CollateralRow[] = (routePreviewData.cdpAllocations || [])
          .filter((item) => BigInt(item.mintAmount || "0") > 0n)
          .map((item) => {
            const depositAmount = BigInt(item.depositAmount || "0");
            const depositUsd = BigInt(item.depositCollateralValueUSD || "0");
            const usedValueWei = depositUsd > 0n ? depositUsd : 0n;
            const usdValue = Number(formatUnits(usedValueWei, 18));
            const usingExistingOnly = depositAmount <= 0n;
            return {
              key: `cdp-route-${item.asset}`,
              address: item.asset,
              symbol: item.symbol,
              source: "CDP Vault",
              sourceSubLabel: usingExistingOnly ? "Allocated by Health Factor (Existing Vault)" : "Allocated by Health Factor",
              balanceText: `Mint: ${Number(formatUnits(BigInt(item.mintAmount || "0"), 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST`,
              amountText: usingExistingOnly
                ? `0.00 ${item.symbol} (new deposit)`
                : `${Number(formatUnits(depositAmount, item.decimals || 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${item.symbol}`,
              usedText: usingExistingOnly
                ? "$0.00 additional used (minting via existing vault headroom)"
                : `${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} routed to CDP`,
              muted: false,
              manual: false,
              inputValue: "",
              availableText: "",
            };
          });
        return [...lendingRows, ...cdpRouteRows];
      }
      return [...rowsFromAmounts(Array.from(recommendedCollateral.entries())), ...existingLendingRows, ...existingCdpVaultRows];
    }

    const manualLendingRows: CollateralRow[] = Array.from(potentialCollateral.keys()).map((asset) => {
      const decimals = asset.customDecimals ?? 18;
      const entry = customCollateralEntries.get(asset.address);
      const amount = getManualCollateralAmount(asset, entry);
      const tokenAmount = Number(formatUnits(amount, decimals));
      const usdValue = Number((amount * BigInt(asset.assetPrice || "0")) / (10n ** BigInt(decimals))) / 1e18;
      const inputValue = entry?.source === "usd" ? entry.usd : usdValue.toFixed(2);
      return {
        key: `lending-manual-${asset.address}`,
        address: asset.address,
        symbol: asset._symbol,
        source: "Lending Collateral",
        sourceSubLabel: "Manual Allocation",
        balanceText: `Balance: ${formatBalance(asset.userBalance || "0", undefined, decimals, 2, 2)} · ${formatBalance(asset.userBalanceValue || "0", undefined, 18, 2, 2, true)}`,
        amountText: `${tokenAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${asset._symbol}`,
        usedText: `${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} used`,
        muted: false,
        manual: true,
        inputValue,
        availableText: formatBalance(asset.userBalanceValue || "0", undefined, 18, 2, 2, true),
        asset,
      };
    });
    return [...manualLendingRows, ...existingCdpVaultRows];
  }, [
    autoAllocate,
    recommendedCollateral,
    potentialCollateral,
    customCollateralEntries,
    cdpVaults,
    collateralInfo,
    routePreviewData,
    routePreviewLoading,
    requestedBorrowWei,
    isLoggedIn,
  ]);

  const lendingRows = useMemo(
    () => collateralRows.filter((row) => row.source === "Lending Collateral"),
    [collateralRows]
  );
  const cdpRows = useMemo(
    () => collateralRows.filter((row) => row.source === "CDP Vault"),
    [collateralRows]
  );

  const ltvNow = useMemo(() => {
    const debt = Number(formatUnits(BigInt(loans?.totalAmountOwed || "0"), 18));
    const collateral = Number(formatUnits(BigInt(loans?.totalCollateralValueSupplied || "0"), 18));
    if (!collateral) return 0;
    return (debt / collateral) * 100;
  }, [loans?.totalAmountOwed, loans?.totalCollateralValueSupplied]);

  const lendingCollateralPayload = useMemo(() => {
    if (autoAllocate) return [];
    return Array.from(selectedCollateral.entries())
      .filter(([, amount]) => amount > 0n)
      .map(([asset, amount]) => ({
        asset: asset.address,
        amount: amount.toString(),
      }));
  }, [autoAllocate, selectedCollateral]);

  const cdpCollateralPayload = useMemo(() => {
    if (autoAllocate) return [];
    return cdpVaults.map((vault) => {
      const entry = customCdpEntries.get(vault.asset);
      const collateralAmountWei = BigInt(vault.collateralAmount || "0");
      const collateralValueWei = BigInt(vault.collateralValueUSD || "0");
      const defaultUsd = collateralValueWei > 0n ? formatUnits(collateralValueWei, 18) : "0";
      const usdInput = (entry?.usd ?? defaultUsd).trim();
      const usdWei = safeParseUnits(usdInput || "0", 18);
      if (usdWei <= 0n || collateralAmountWei <= 0n || collateralValueWei <= 0n) {
        return { asset: vault.asset, amount: "0" };
      }
      const cappedUsdWei = usdWei > collateralValueWei ? collateralValueWei : usdWei;
      const amountWei = (cappedUsdWei * collateralAmountWei) / collateralValueWei;
      return { asset: vault.asset, amount: amountWei.toString() };
    });
  }, [autoAllocate, cdpVaults, customCdpEntries]);

  useEffect(() => {
    if (!isLoggedIn || requestedBorrowWei <= 0n) {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
      setRoutePreviewData(null);
      setRoutePreviewLoading(false);
      return;
    }

    let cancelled = false;
    const fetchRoutePreview = async () => {
      try {
        setRoutePreviewLoading(true);
        const res = await api.post<RoutePreviewApiResponse>("/borrow-router/preview", {
          amount: requestedBorrowWei.toString(),
          targetHealthFactor,
          lendingCollateral: lendingCollateralPayload,
          cdpCollateral: cdpCollateralPayload,
        });
        if (!cancelled) {
          setRoutePreviewData(res.data);
        }
      } catch {
        // Keep last good preview to avoid UI flicker to fallback mode.
      } finally {
        if (!cancelled) {
          setRoutePreviewLoading(false);
        }
      }
    };

    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
    }
    previewDebounceRef.current = setTimeout(() => {
      fetchRoutePreview();
    }, 220);
    return () => {
      cancelled = true;
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
    };
  }, [isLoggedIn, requestedBorrowWei, targetHealthFactor, lendingCollateralPayload, cdpCollateralPayload]);

  const previewPending = requestedBorrowWei > 0n && routePreviewLoading && !routePreviewData;
  const previewRefreshing = requestedBorrowWei > 0n && routePreviewLoading;

  const routePreview = useMemo(() => {
    const fallbackLendingApr = Number(((loans?.interestRate || 0) / 100).toFixed(2));
    if (!routePreviewData) {
      return {
        lendingAmount: previewPending ? 0 : requestedBorrow > 0 ? requestedBorrow : 0,
        cdpAmount: 0,
        mechanisms: previewPending ? 0 : requestedBorrow > 0 ? 1 : 0,
        lendingApr: fallbackLendingApr,
        cdpApr: 0,
        blendedApr: previewPending ? 0 : fallbackLendingApr,
        cdpDebt: 0,
        cdpCollateralUsd: 0,
        liquidationDropPercent: 0,
        liquidationHealthFactor: 1,
        liquidationPriceUSD: 0,
        liquidationAssetSymbol: "USD",
        swapPairs: 0,
        earnApr: 0,
        cdpCR: 0,
        unifiedHealthFactor: targetHealthFactor,
        lendingHF: targetHealthFactor,
        cdpEffectiveHF: targetHealthFactor,
        projectedLtvPercent: ltvNow,
      };
    }

    const lendingAmount = Number(formatUnits(BigInt(routePreviewData.split.lendingAmount || "0"), 18));
    const cdpAmount = Number(formatUnits(BigInt(routePreviewData.split.cdpAmount || "0"), 18));
    const cdpCollateralUsd = routePreviewData.cdpAllocations.reduce((sum, item) => {
      const value = Number(formatUnits(BigInt(item.collateralValueUSD || "0"), 18));
      return sum + value;
    }, 0);

    return {
      lendingAmount,
      cdpAmount,
      mechanisms: Number(routePreviewData.split.mechanisms || 0),
      lendingApr: Number(routePreviewData.rates.lendingApr || 0),
      cdpApr: Number(routePreviewData.rates.cdpApr || 0),
      blendedApr: Number(routePreviewData.rates.blendedApr || 0),
      cdpDebt: cdpAmount,
      cdpCollateralUsd,
      liquidationDropPercent: Number(routePreviewData.position?.liquidationDropPercent || 0),
      liquidationHealthFactor: Number(routePreviewData.position?.liquidationHealthFactor || 1),
      liquidationPriceUSD: Number(routePreviewData.position?.liquidationPriceUSD || 0),
      liquidationAssetSymbol: routePreviewData.position?.liquidationAssetSymbol || "USD",
      swapPairs: 0,
      earnApr: 0,
      cdpCR: Number(routePreviewData.health.cdpCollateralRatio || 0),
      unifiedHealthFactor: Number(routePreviewData.health.unifiedHealthFactor || targetHealthFactor),
      lendingHF: Number(routePreviewData.health.lendingHealthFactor || targetHealthFactor),
      cdpEffectiveHF: Number(routePreviewData.health.cdpEffectiveHealthFactor || targetHealthFactor),
      projectedLtvPercent: Number(routePreviewData.position?.projectedLtvPercent || ltvNow),
    };
  }, [routePreviewData, requestedBorrow, loans?.interestRate, targetHealthFactor, ltvNow, previewPending]);

  const routingReasonText = useMemo(() => {
    const reason = routePreviewData?.routing?.selectionReason;
    if (!reason) return "";
    const mapping: Record<string, string> = {
      insufficient_total_capacity: "Route limited by total available capacity.",
      cdp_capacity_unavailable_or_constrained: "CDP route unavailable or constrained at current settings.",
      lending_apr_optimal: "Lending-only route selected as lowest APR option.",
      cdp_constraints_prevented_split: "CDP constraints prevented a lower blended split.",
      cdp_apr_optimal: "CDP-only route selected as lowest APR option.",
      blended_apr_optimal_split: "Mixed Lending + CDP split selected for minimum blended APR.",
    };
    return mapping[reason] || "Route selected by optimizer constraints.";
  }, [routePreviewData?.routing?.selectionReason]);

  const maxBorrowableWei = useMemo(() => {
    if (routePreviewData?.constraints?.totalCapacity) {
      try {
        return BigInt(routePreviewData.constraints.totalCapacity);
      } catch {
        return availableToBorrow;
      }
    }
    return availableToBorrow;
  }, [routePreviewData?.constraints?.totalCapacity, availableToBorrow]);

  const lendingRouteCollateralText = useMemo(() => {
    const allocations = routePreviewData?.lendingAllocations || [];
    if (allocations.length === 0) return "No additional collateral needed";
    return allocations
      .filter((item) => BigInt(item.supplyAmount || "0") > 0n)
      .map((item) => `${Number(formatUnits(BigInt(item.supplyAmount || "0"), item.decimals || 18)).toFixed(2)} ${item.symbol}`)
      .join(" + ");
  }, [routePreviewData?.lendingAllocations]);

  const cdpRouteCollateralText = useMemo(() => {
    const allocations = routePreviewData?.cdpAllocations || [];
    if (allocations.length === 0) return "No CDP collateral needed";
    const withDeposit = allocations.filter((item) => BigInt(item.depositAmount || "0") > 0n);
    if (withDeposit.length > 0) {
      return withDeposit
        .map((item) => `${Number(formatUnits(BigInt(item.depositAmount || "0"), item.decimals || 18)).toFixed(2)} ${item.symbol}`)
        .join(" + ");
    }
    const withExisting = allocations.filter((item) => BigInt(item.mintAmount || "0") > 0n);
    if (withExisting.length > 0) {
      return withExisting.map((item) => `${item.symbol} (existing vault collateral)`).join(" + ");
    }
    return "No CDP collateral needed";
  }, [routePreviewData?.cdpAllocations]);

  const cdpMintSourceText = useMemo(() => {
    const fresh = routePreviewData?.routing?.cdpFromFreshCollateral;
    const existing = routePreviewData?.routing?.cdpFromExistingCollateral;
    if (!fresh && !existing) return "";
    let freshAmount = 0;
    let existingAmount = 0;
    try {
      freshAmount = Number(formatUnits(BigInt(fresh || "0"), 18));
      existingAmount = Number(formatUnits(BigInt(existing || "0"), 18));
    } catch {
      return "";
    }
    if (freshAmount <= 0 && existingAmount <= 0) return "";
    return `CDP source: fresh deposit ${freshAmount.toFixed(2)} USDST, existing vault collateral ${existingAmount.toFixed(2)} USDST.`;
  }, [routePreviewData?.routing?.cdpFromFreshCollateral, routePreviewData?.routing?.cdpFromExistingCollateral]);

  const cdpCapacityBreakdownText = useMemo(() => {
    const existing = routePreviewData?.constraints?.cdpCapacityFromExistingCollateral;
    const fresh = routePreviewData?.constraints?.cdpCapacityFromFreshCollateral;
    if (!existing && !fresh) return "";
    let existingAmount = 0;
    let freshAmount = 0;
    try {
      existingAmount = Number(formatUnits(BigInt(existing || "0"), 18));
      freshAmount = Number(formatUnits(BigInt(fresh || "0"), 18));
    } catch {
      return "";
    }
    return `CDP capacity: existing ${existingAmount.toFixed(2)} USDST + fresh ${freshAmount.toFixed(2)} USDST.`;
  }, [routePreviewData?.constraints?.cdpCapacityFromExistingCollateral, routePreviewData?.constraints?.cdpCapacityFromFreshCollateral]);

  const totalCdpDebtActual = useMemo(() => {
    return cdpVaults.reduce((sum, vault) => sum + Number(formatUnits(BigInt(vault.debtAmount || "0"), 18)), 0);
  }, [cdpVaults]);

  const sliderRange = useMemo(() => {
    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
    return max - min;
  }, [sliderExtrema.min, sliderExtrema.max]);

  const sliderPosition = useMemo(() => {
    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
    const clamped = Math.max(min, Math.min(max, Number(targetHealthFactor)));
    return max - clamped;
  }, [targetHealthFactor, sliderExtrema.min, sliderExtrema.max]);

  useEffect(() => {
    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const current = Number(targetHealthFactor);
    if (current < min || current > max) {
      const clamped = Math.max(min, Math.min(max, current));
      setTargetHealthFactor(Number(clamped.toFixed(2)));
    }
  }, [sliderExtrema.min, sliderExtrema.max, targetHealthFactor]);

  const handleHealthSliderChange = (values: number[]) => {
    const sliderPos = values[0] ?? 0;
    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const newHF = max - sliderPos;
    setTargetHealthFactor(Number(newHF.toFixed(2)));
  };

  const displayHealthFactor = useMemo(() => {
    if (previewRefreshing) {
      return Number(targetHealthFactor);
    }
    if (routePreviewData?.health?.unifiedHealthFactor && routePreviewData.health.unifiedHealthFactor > 0) {
      return Number(routePreviewData.health.unifiedHealthFactor);
    }
    if (loans && requestedBorrow > 0) {
      const fallbackAfterBorrow = calculateAfterBorrowHealthFactor(loans, requestedBorrow, selectedCollateral);
      const fallbackNumeric = Number(fallbackAfterBorrow ?? 0);
      if (Number.isFinite(fallbackNumeric) && fallbackNumeric > 0) {
        return fallbackNumeric;
      }
    }
    return Number(targetHealthFactor);
  }, [previewRefreshing, routePreviewData?.health?.unifiedHealthFactor, loans, requestedBorrow, selectedCollateral, targetHealthFactor]);

  const projectedHealthFactor = useMemo(() => {
    const hf = Number(routePreviewData?.health?.unifiedHealthFactor || 0);
    if (!Number.isFinite(hf) || hf <= 0) return null;
    return hf;
  }, [routePreviewData?.health?.unifiedHealthFactor]);

  const handleBorrowNow = async () => {
    if (guestMode) return;
    if (requestedBorrowWei <= 0n) {
      setInlineBorrowError("Enter a borrow amount greater than zero");
      return;
    }
    if (requestedBorrowWei > maxBorrowableWei) {
      setInlineBorrowError("Borrow amount exceeds available limit");
      return;
    }
    if (routePreviewData && !routePreviewData.feasible) {
      const shortfall = Number(formatUnits(BigInt(routePreviewData.shortfall || "0"), 18));
      setInlineBorrowError(`Insufficient routed capacity. Shortfall: ${shortfall.toFixed(2)} USDST`);
      return;
    }

    setInlineBorrowError("");
    try {
      setBorrowLoading(true);
      const res = await api.post<ExecuteBorrowRouteResponse>("/borrow-router/execute", {
        amount: requestedBorrowWei.toString(),
        targetHealthFactor,
        lendingCollateral: lendingCollateralPayload,
        cdpCollateral: cdpCollateralPayload,
      });
      if (res.data?.status !== "success") {
        const failedStep = res.data?.steps?.find((step) => step.status === "failed");
        const lendingBorrowed = Number(formatUnits(BigInt(res.data?.execution?.lendingBorrowed || "0"), 18));
        const cdpMinted = Number(formatUnits(BigInt(res.data?.execution?.cdpMinted || "0"), 18));
        const fallbackError = res.data?.error || "Borrow partially executed. Please review route details and retry safely.";
        const partialDetails = lendingBorrowed > 0 || cdpMinted > 0
          ? ` Executed: Lending ${lendingBorrowed.toFixed(2)} USDST, CDP ${cdpMinted.toFixed(2)} USDST.`
          : "";
        setInlineBorrowError(`${failedStep?.error || fallbackError}${partialDetails}`);
        return;
      }
      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${requestedBorrow.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USDST`,
        variant: "success",
      });
      setLendingCollateralStatus("loading");
      setCdpVaultsStatus("loading");
      const [, collateralResult, , vaultsResult] = await Promise.allSettled([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
        api.get<CdpVault[]>("/cdp/vaults"),
      ]);
      setLendingCollateralStatus(collateralResult.status === "fulfilled" ? "success" : "error");
      if (vaultsResult.status === "fulfilled") {
        setCdpVaults(Array.isArray(vaultsResult.value.data) ? vaultsResult.value.data : []);
        setCdpVaultsStatus("success");
      } else {
        setCdpVaults([]);
        setCdpVaultsStatus("error");
      }
      setBorrowInput("");
      setSelectedBorrowPreset(null);
      setRoutePreviewData(null);
    } catch (error: unknown) {
      const errorObj = error as { message?: string; response?: { data?: ExecuteBorrowRouteResponse } };
      const responseData = errorObj?.response?.data;
      const failedStep = responseData?.steps?.find((step) => step.status === "failed");
      const lendingBorrowed = Number(formatUnits(BigInt(responseData?.execution?.lendingBorrowed || "0"), 18));
      const cdpMinted = Number(formatUnits(BigInt(responseData?.execution?.cdpMinted || "0"), 18));
      const partialDetails = lendingBorrowed > 0 || cdpMinted > 0
        ? ` Executed: Lending ${lendingBorrowed.toFixed(2)} USDST, CDP ${cdpMinted.toFixed(2)} USDST.`
        : "";
      setInlineBorrowError(
        (failedStep?.error ||
          responseData?.error ||
          errorObj?.message ||
          "Borrow execution failed. Please try again.") + partialDetails
      );
    } finally {
      setBorrowLoading(false);
    }
  };

  const handleRepayNow = async (amount: string) => {
    if (guestMode) return;
    try {
      setInlineRepayError("");
      setRepayLoading(true);
      if (amount === "ALL") {
        await repayAll();
      } else {
        await repayLoan({ amount });
      }
      toast({
        title: "Repay Submitted",
        description: amount === "ALL" ? "Repay all transaction submitted." : "Repay transaction submitted.",
        variant: "success",
      });
      setLendingCollateralStatus("loading");
      setCdpVaultsStatus("loading");
      const [, collateralResult, , vaultsResult] = await Promise.allSettled([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
        api.get<CdpVault[]>("/cdp/vaults"),
      ]);
      setLendingCollateralStatus(collateralResult.status === "fulfilled" ? "success" : "error");
      if (vaultsResult.status === "fulfilled") {
        setCdpVaults(Array.isArray(vaultsResult.value.data) ? vaultsResult.value.data : []);
        setCdpVaultsStatus("success");
      } else {
        setCdpVaults([]);
        setCdpVaultsStatus("error");
      }
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      setInlineRepayError(errorObj?.message || "Repay failed");
    } finally {
      setRepayLoading(false);
    }
  };

  const renderCollateralRow = (row: CollateralRow) => {
    const iconBg = row.symbol === "ETHST" ? "bg-slate-500/50" : row.symbol === "GOLDST" ? "bg-amber-500/60" : "bg-orange-600/50";
    return (
      <div key={row.key} className="flex items-center justify-between px-4 py-4 border-t border-border/50">
        <div className="flex items-center gap-3">
          <span className={`w-10 h-10 rounded-full ${iconBg} inline-flex items-center justify-center text-sm font-semibold`}>
            {row.symbol.slice(0, 1)}
          </span>
          <div>
            <p className={`font-medium ${row.muted ? "text-muted-foreground/70" : ""}`}>{row.symbol}</p>
            <p className="text-[10px] text-muted-foreground">{row.source}{row.sourceSubLabel ? ` · ${row.sourceSubLabel}` : ""}</p>
            <p className={`text-xs text-muted-foreground ${row.muted ? "opacity-70" : ""}`}>{row.balanceText}</p>
          </div>
        </div>
        <div className="text-right">
          {row.manual && row.asset ? (
            <div className="space-y-1">
              <div className="flex items-center justify-end gap-1">
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                  value={row.inputValue}
                  onChange={(e) => handleCustomCollateralValueChange(row.address, e.target.value)}
                  disabled={guestMode}
                  className={`h-7 w-24 px-2 text-right text-xs ${manualCollateralInputErrors.get(row.address) ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                />
              </div>
              {manualCollateralInputErrors.get(row.address) ? (
                <p className="text-[10px] text-red-500">{manualCollateralInputErrors.get(row.address)}</p>
              ) : null}
              <button
                type="button"
                onClick={() => handleFillMaxCollateral(row.asset)}
                className="text-xs text-muted-foreground underline"
                disabled={guestMode}
              >
                {row.availableText}
              </button>
            </div>
          ) : (
            <>
              {row.amountText ? <p className="font-semibold">{row.amountText}</p> : null}
              <p className={`text-xs text-muted-foreground ${row.muted ? "opacity-70" : ""}`}>{row.usedText}</p>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Borrow" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && <GuestSignInBanner message="Sign in to borrow USDST" />}
          {isLoggedIn && <LiquidationAlertBanner />}
          <p className="max-w-5xl mx-auto text-sm text-muted-foreground mb-4">Use your assets as collateral to borrow.</p>

          <div className="max-w-5xl mx-auto space-y-4">
            <div className="flex items-center gap-3 px-1">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary inline-flex items-center justify-center text-xs font-semibold">1</span>
              <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">I WANT TO BORROW</p>
            </div>
            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-4 md:p-5 space-y-4 rounded-xl border border-border/70 bg-card dark:bg-[#1f274f]">
                <div className="flex items-start justify-between gap-4">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 dark:border-[#2d3765] dark:bg-[#232d57] px-4 py-3 text-sm w-fit mt-1">
                    <CircleDollarSign className="h-5 w-5 text-blue-400" />
                    <span className="font-semibold text-base text-foreground">USDST</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
                  </div>
                  <div className="flex-1 max-w-[220px] ml-auto">
                    <Input
                      placeholder="0.00"
                      value={borrowInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(/,/g, "");
                        if (/^\d*\.?\d*$/.test(value)) {
                          const enteredWei = safeParseUnits(value || "0", 18);
                          if (maxBorrowableWei > 0n && enteredWei > maxBorrowableWei) {
                            setBorrowInput(Number(formatUnits(maxBorrowableWei, 18)).toFixed(2));
                            setInlineBorrowError("Amount capped at max borrowable limit");
                          } else {
                            setBorrowInput(value);
                            if (inlineBorrowError === "Amount capped at max borrowable limit") {
                              setInlineBorrowError("");
                            }
                          }
                          setSelectedBorrowPreset(null);
                        }
                      }}
                      disabled={guestMode}
                      className="text-right text-4xl font-semibold h-14 border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-2xl text-muted-foreground">
                    ≈ ${requestedBorrowUsdDisplay}
                  </p>
                  <div className="flex items-center gap-2">
                  {[25, 50, 75].map((percent) => (
                    <Button
                      key={percent}
                      variant="outline"
                      size="sm"
                      className={`h-9 px-4 rounded-lg border-border dark:border-[#394472] ${
                        selectedBorrowPreset === percent
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground"
                          : "bg-transparent hover:bg-muted/70 dark:bg-[#1e274e] dark:hover:bg-[#2b376a]"
                      }`}
                      disabled={guestMode || maxBorrowableWei <= 0n}
                      onClick={() => {
                        const percentAmount = Number(formatUnits(maxBorrowableWei, 18)) * (percent / 100);
                        setBorrowInput(percentAmount.toFixed(2));
                        setSelectedBorrowPreset(percent);
                      }}
                    >
                      {percent}%
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-9 px-4 rounded-lg border-border dark:border-[#394472] ${
                      selectedBorrowPreset === 100
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground"
                        : "bg-transparent hover:bg-muted/70 dark:bg-[#1e274e] dark:hover:bg-[#2b376a]"
                    }`}
                    disabled={guestMode || maxBorrowableWei <= 0n}
                    onClick={() => {
                      setBorrowInput(Number(formatUnits(maxBorrowableWei, 18)).toFixed(2));
                      setSelectedBorrowPreset(100);
                    }}
                  >
                    Max
                  </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3 px-1 pt-2">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary inline-flex items-center justify-center text-xs font-semibold">2</span>
              <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">YOUR COLLATERAL (LENDING + CDP)</p>
            </div>
            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0 space-y-2">
                <div className="rounded-lg border border-border/70 overflow-hidden bg-card dark:bg-[#1f274f]">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-sm font-medium">Auto-allocate</p>
                    <p className="text-xs text-muted-foreground">- optimal mix for best rate</p>
                  </div>
                  <button
                    className="inline-flex items-center"
                    onClick={handleAutoAllocateToggle}
                    disabled={guestMode}
                  >
                    <span className={`w-12 h-6 rounded-full transition ${autoAllocate ? "bg-primary" : "bg-muted"} relative`}>
                      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${autoAllocate ? "left-7" : "left-1"}`} />
                    </span>
                  </button>
                </div>
                {lendingCollateralStatus === "loading" ? (
                  <div className="border-t border-border/50 px-4 py-4 space-y-3">
                    <p className="text-xs text-muted-foreground">Loading lending collateral...</p>
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : null}
                {lendingCollateralStatus === "error" ? (
                  <div className="border-t border-border/50 px-4 py-4 text-xs text-amber-600">
                    Lending collateral unavailable. Showing available sources only.
                  </div>
                ) : null}
                {requestedBorrowWei > 0n && routePreviewLoading ? (
                  <div className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
                    Calculating optimal Lending/CDP split for selected health factor...
                  </div>
                ) : null}
                {lendingRows.map(renderCollateralRow)}

                {cdpVaultsStatus === "loading" ? (
                  <div className="border-t border-border/50 px-4 py-4 space-y-3">
                    <p className="text-xs text-muted-foreground">Loading CDP vault collateral...</p>
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : null}
                {cdpVaultsStatus === "error" ? (
                  <div className="border-t border-border/50 px-4 py-4 text-xs text-amber-600">
                    CDP vault data unavailable. Lending collateral is still usable.
                  </div>
                ) : null}
                {!autoAllocate && cdpVaultsStatus !== "loading" && cdpVaults.length > 0 ? (
                  <div className="border-t border-border/50 px-4 py-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Manual CDP cap (USD): set how much existing vault collateral value each CDP token can use.
                    </p>
                    <div className="space-y-2">
                      {cdpVaults.map((vault) => {
                        const entry = customCdpEntries.get(vault.asset);
                        const maxUsd = Number(formatUnits(BigInt(vault.collateralValueUSD || "0"), 18));
                        const inputValue = entry?.usd ?? maxUsd.toFixed(2);
                        return (
                          <div key={`manual-cdp-${vault.asset}`} className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-2">
                            <div>
                              <p className="text-sm font-medium">{vault.symbol}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Max: ${maxUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from existing vault collateral
                              </p>
                            </div>
                            <div className="space-y-1 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-xs text-muted-foreground">$</span>
                                <Input
                                  value={inputValue}
                                  onChange={(e) => handleCustomCdpValueChange(vault.asset, e.target.value)}
                                  disabled={guestMode}
                                  className={`h-7 w-28 px-2 text-right text-xs ${manualCdpInputErrors.get(vault.asset) ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                                />
                              </div>
                              {manualCdpInputErrors.get(vault.asset) ? (
                                <p className="text-[10px] text-red-500">{manualCdpInputErrors.get(vault.asset)}</p>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleFillMaxCdpCollateral(vault)}
                                className="text-xs text-muted-foreground underline"
                                disabled={guestMode}
                              >
                                Use max
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {autoAllocate ? cdpRows.map(renderCollateralRow) : null}

                {lendingCollateralStatus !== "loading" &&
                cdpVaultsStatus !== "loading" &&
                lendingCollateralStatus !== "error" &&
                cdpVaultsStatus !== "error" &&
                collateralRows.length === 0 ? (
                  <div className="px-4 py-6 border-t border-border/50 text-sm text-muted-foreground text-center">
                    No data found
                  </div>
                ) : null}
                <div className="flex justify-between text-sm px-4 py-4 border-t border-border/50">
                  <span className="text-muted-foreground">
                    {routePreviewData && requestedBorrowWei > 0n ? "Total additional collateral used" : "Total collateral used"}
                  </span>
                  <span className="font-semibold">
                    {previewRefreshing
                      ? "Updating..."
                      : `$${(Number(totalCollateralUsedWei) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </span>
                </div>
                {routePreviewData && requestedBorrowWei > 0n ? (
                  <div className="flex justify-between text-sm px-4 py-4 border-t border-border/50">
                    <span className="text-muted-foreground">Total borrow routed</span>
                    <span className="font-semibold">
                      {previewRefreshing
                        ? "Updating..."
                        : `${(Number(totalBorrowRoutedWei) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST`}
                    </span>
                  </div>
                ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3 px-1 pt-2">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary inline-flex items-center justify-center text-xs font-semibold">3</span>
              <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">POSITION HEALTH</p>
            </div>
            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-4 md:p-5 space-y-3 rounded-xl border border-border/70 bg-card dark:bg-[#1f274f]">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    {getRiskLabel(displayHealthFactor)}
                  </span>
                  <span className="font-semibold">
                    {previewRefreshing
                      ? `Target HF: ${Number(targetHealthFactor).toFixed(1)}x · Projected HF: Updating...`
                      : `Target HF: ${Number(targetHealthFactor).toFixed(1)}x · Projected HF: ${(projectedHealthFactor ?? displayHealthFactor).toFixed(1)}x`}
                  </span>
                </div>
                <Slider
                  value={[sliderPosition]}
                  min={0}
                  max={sliderRange}
                  step={0.01}
                  onValueChange={handleHealthSliderChange}
                  className="w-full"
                  disabled={guestMode || sliderRange <= 0}
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Liquidation</span>
                  <span>Risky</span>
                  <span>Healthy</span>
                  <span>Safe</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">LTV</p>
                    <p className="font-semibold">
                      {previewRefreshing ? "Updating..." : `${routePreview.projectedLtvPercent.toFixed(1)}%`}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Blended Rate</p>
                    <p className="font-semibold">
                      {previewRefreshing ? "Updating..." : `${routePreview.blendedApr.toFixed(2)}% APR`}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Liquidation At</p>
                    <p className="font-semibold">
                      {previewRefreshing
                        ? "Updating..."
                        : `$${routePreview.liquidationPriceUSD.toFixed(2)} ${routePreview.liquidationAssetSymbol} (${routePreview.liquidationDropPercent.toFixed(1)}% drop)`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              className="w-full h-12 text-base"
              disabled={guestMode || borrowLoading || routePreviewLoading || requestedBorrowWei <= 0n || requestedBorrowWei > maxBorrowableWei}
              onClick={handleBorrowNow}
            >
              {borrowLoading ? "Processing..." : `Borrow ${(requestedBorrow || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST`}
            </Button>
            {inlineBorrowError && <p className="text-sm text-red-600">{inlineBorrowError}</p>}

            <RewardsWidget
              userRewards={userRewards}
              activityName="Lending Pool Borrow"
              inputAmount={normalizedBorrowInput || "0"}
              actionLabel="Borrow"
            />

            <button
              className="w-full text-sm text-muted-foreground inline-flex items-center justify-center gap-1.5"
              onClick={() => setShowDetails((prev) => !prev)}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
              View route details
            </button>

            {showDetails && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 px-1 pt-2">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary inline-flex items-center justify-center text-xs font-semibold">4</span>
                  <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">
                    {`BORROW ROUTED ACROSS ${Math.max(2, routePreview.mechanisms)} MECHANISM${Math.max(2, routePreview.mechanisms) > 1 ? "S" : ""}`}
                  </p>
                </div>
                <Card className="border-0 shadow-none bg-transparent">
                  <CardContent className="p-4 md:p-5 space-y-0 rounded-xl border border-border/70 bg-card dark:bg-[#1f274f]">
                    {previewRefreshing ? (
                      <div className="pb-3 border-b border-border/60">
                        <p className="text-xs text-muted-foreground text-right">Updating route preview...</p>
                      </div>
                    ) : null}
                    <div className="py-3 min-h-[86px] flex items-center justify-between border-b border-border/60">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 text-primary" />
                        <div>
                        <p className="font-medium">Lending Pool</p>
                        <p className="text-xs text-muted-foreground">{routePreview.lendingApr.toFixed(2)}% APR</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {previewRefreshing
                            ? "Updating..."
                            : `${routePreview.lendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST`}
                        </p>
                        <p className="text-xs text-emerald-500">{previewRefreshing ? "..." : `${routePreview.lendingHF.toFixed(1)}x`}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{previewRefreshing ? "Recomputing..." : lendingRouteCollateralText}</p>
                      </div>
                    </div>
                    <div className="py-3 min-h-[86px] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Coins className="h-4 w-4 text-primary" />
                        <div>
                        <p className="font-medium">CDP Mint</p>
                        <p className="text-xs text-muted-foreground">{routePreview.cdpApr.toFixed(2)}% fee</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {previewRefreshing
                            ? "Updating..."
                            : `${routePreview.cdpAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST`}
                        </p>
                        <p className="text-xs text-emerald-500">
                          {previewRefreshing ? "..." : `CR ${routePreview.cdpCR.toFixed(1)}% · HF ${routePreview.cdpEffectiveHF.toFixed(2)}x`}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">{previewRefreshing ? "Recomputing..." : cdpRouteCollateralText}</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-border/60">
                      <p className="text-right text-sm font-semibold text-emerald-500">
                        {previewPending || previewRefreshing
                          ? "Blended rate (weighted): Calculating..."
                          : `Blended rate (weighted): ${routePreview.blendedApr.toFixed(2)}% APR`}
                      </p>
                      {!previewRefreshing && routingReasonText ? (
                        <p className="text-right text-[11px] text-muted-foreground mt-1">{routingReasonText}</p>
                      ) : null}
                      {!previewRefreshing && cdpMintSourceText ? (
                        <p className="text-right text-[11px] text-muted-foreground mt-1">{cdpMintSourceText}</p>
                      ) : null}
                      {!previewRefreshing && cdpCapacityBreakdownText ? (
                        <p className="text-right text-[11px] text-muted-foreground mt-1">{cdpCapacityBreakdownText}</p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center gap-3 px-1 pt-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 inline-flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">WHAT YOU CAN DO WITH BORROWED USDST</p>
                </div>
                <Card className="border-0 shadow-none bg-transparent">
                  <CardContent className="p-2 md:p-0 grid grid-cols-1 md:grid-cols-3 gap-4 bg-transparent border-0">
                    <div className="rounded-2xl border border-border bg-card p-4 min-h-[160px] dark:border-[#2f3b6c] dark:bg-[#212a52]">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted mb-3 dark:bg-[#2a3567]">
                        <ArrowLeftRight className="h-4 w-4 text-primary dark:text-[#98A4FF]" />
                      </span>
                      <p className="font-semibold text-3xl leading-8">Swap</p>
                      <p className="text-base text-muted-foreground mt-2 leading-6 dark:text-[#9DA7C5]">Trade for ETHST, GOLDST, etc.</p>
                      <p className="text-3xl mt-3 font-semibold text-violet-500 leading-8 dark:text-violet-400">{routePreview.swapPairs} pairs available</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-4 min-h-[160px] dark:border-[#2f3b6c] dark:bg-[#212a52]">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 mb-3 dark:bg-[#1f4d5b]">
                        <HandCoins className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                      </span>
                      <p className="font-semibold text-3xl leading-8">Earn</p>
                      <p className="text-base text-muted-foreground mt-2 leading-6 dark:text-[#9DA7C5]">Lend or provide liquidity</p>
                      <p className="text-3xl mt-3 font-semibold text-emerald-600 leading-8 dark:text-emerald-400">up to {routePreview.earnApr.toFixed(1)}% APR</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-4 min-h-[160px] dark:border-[#2f3b6c] dark:bg-[#212a52]">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 mb-3 dark:bg-[#203765]">
                        <Send className="h-4 w-4 text-blue-600 dark:text-[#68A2FF]" />
                      </span>
                      <p className="font-semibold text-3xl leading-8">Transfer</p>
                      <p className="text-base text-muted-foreground mt-2 leading-6 dark:text-[#9DA7C5]">Send to another address</p>
                      <p className="text-3xl mt-3 font-semibold text-blue-600 leading-8 dark:text-blue-400">Instant on STRATO</p>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center gap-3 px-1 pt-2">
                  <span className="w-6 h-6 rounded-full bg-primary/20 text-primary inline-flex items-center justify-center text-xs font-semibold">6</span>
                  <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">YOUR ACTIVE POSITIONS</p>
                </div>
                <Card className="border-0 shadow-none bg-transparent">
                  <CardContent className="p-4 md:p-5 space-y-3 rounded-xl border border-border/70 bg-card dark:bg-[#1f274f]">
                    <div className="rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] p-3 min-h-[94px] flex items-center justify-between">
                      <div>
                        <p className="font-medium">Lending Pool</p>
                        <p className="text-xs text-muted-foreground">Collateral {formatBalance(loans?.totalCollateralValueSupplied || "0", undefined, 18, 2, 2, true)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatBalance(loans?.totalAmountOwed || "0", "USDST", 18, 2, 2)}</p>
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowRepayPanel((prev) => !prev)}>Repay</Button>
                      </div>
                    </div>
                    {showRepayPanel ? (
                      <div className="rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] p-3">
                        <RepayForm
                          loans={loans || null}
                          repayLoading={repayLoading}
                          onRepay={handleRepayNow}
                          usdstBalance={usdstBalance}
                          voucherBalance={voucherBalance}
                          guestMode={guestMode}
                        />
                        {inlineRepayError ? <p className="text-sm text-red-600 mt-2">{inlineRepayError}</p> : null}
                      </div>
                    ) : null}
                    {cdpVaults.length > 0 ? (
                      cdpVaults.map((vault) => (
                        <div key={vault.asset} className="rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] p-3 min-h-[94px] flex items-center justify-between">
                          <div>
                            <p className="font-medium">CDP Vault - {vault.symbol}</p>
                            <p className="text-xs text-muted-foreground">
                              Collateral {formatBalance(vault.collateralValueUSD || "0", undefined, 18, 2, 2, true)} · CR {Number(vault.collateralizationRatio || 0).toFixed(1)}%
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatBalance(vault.debtAmount || "0", "USDST", 18, 2, 2)}</p>
                            <Button variant="outline" size="sm" className="mt-2" disabled>Repay</Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] p-3 text-sm text-muted-foreground">
                        No CDP positions found
                      </div>
                    )}
                    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] px-3 py-2 text-sm">
                      <span className="text-muted-foreground inline-flex items-center gap-2">
                        <CirclePlus className="h-4 w-4" />
                        Total debt across all positions
                      </span>
                      <span className="font-semibold">
                        {(Number(formatUnits(BigInt(loans?.totalAmountOwed || "0"), 18)) + totalCdpDebtActual).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} USDST
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default Borrow;
