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
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidationAlertBanner from "@/components/ui/LiquidationAlertBanner";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { CollateralData } from "@/interface";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import {
  calculateAfterBorrowHealthFactor,
  calculateAvailableToBorrowUSD,
  calculateHFSliderExtrema,
  getRiskLabel,
  recommendCollateralToSupply,
} from "@/utils/lendingUtils";

const Borrow = () => {
  const { userAddress, isLoggedIn } = useUser();
  const { fetchUsdstBalance } = useTokenContext();
  const { toast } = useToast();
  const {
    loans,
    collateralInfo,
    liquidityInfo,
    refreshLoans,
    refreshCollateral,
    borrowAsset,
    borrowMax,
    supplyCollateral,
  } = useLendingContext();
  const { getPrice } = useOracleContext();

  const [borrowInput, setBorrowInput] = useState("");
  const [selectedBorrowPreset, setSelectedBorrowPreset] = useState<number | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [inlineBorrowError, setInlineBorrowError] = useState("");
  const [autoAllocate, setAutoAllocate] = useState(true);
  const [targetHealthFactor, setTargetHealthFactor] = useState(2.1);
  const [showDetails, setShowDetails] = useState(true);
  const [isDraggingHealthBar, setIsDraggingHealthBar] = useState(false);
  const healthBarRef = useRef<HTMLDivElement | null>(null);
  const { userRewards } = useRewardsUserInfo();

  const guestMode = !isLoggedIn;
  type CustomCollateralEntry = { source: "wei"; wei: bigint } | { source: "usd"; usd: string };
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
    if (!isLoggedIn) return;
    const refreshData = async () => {
      try {
        await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
      } catch (error) {
        console.error("Error refreshing borrow page data:", error);
      }
    };
    refreshData();
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
    return Array.from(selectedCollateral.entries()).reduce((sum, [asset, amount]) => {
      const decimals = BigInt(asset.customDecimals ?? 18);
      const price = BigInt(asset.assetPrice || "0");
      return sum + (amount * price) / (10n ** decimals);
    }, 0n);
  }, [selectedCollateral]);

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
      } else {
        setCustomCollateralEntries(new Map());
        setManualCollateralInputErrors(new Map());
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

  const collateralRows = useMemo(() => {
    const rowsFromAmounts = (entries: Array<[CollateralData, bigint]>) => {
      return entries
        .filter(([, amount]) => amount > 0n)
        .slice(0, 3)
        .map(([asset, amount]) => {
          const decimals = asset.customDecimals ?? 18;
          const tokenAmount = Number(formatUnits(amount, decimals));
          const usdValue = Number((amount * BigInt(asset.assetPrice || "0")) / (10n ** BigInt(decimals))) / 1e18;
          return {
            address: asset.address,
            symbol: asset._symbol,
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

    if (autoAllocate) {
      return rowsFromAmounts(Array.from(recommendedCollateral.entries()));
    }

    return Array.from(potentialCollateral.keys()).map((asset) => {
      const decimals = asset.customDecimals ?? 18;
      const entry = customCollateralEntries.get(asset.address);
      const amount = getManualCollateralAmount(asset, entry);
      const tokenAmount = Number(formatUnits(amount, decimals));
      const usdValue = Number((amount * BigInt(asset.assetPrice || "0")) / (10n ** BigInt(decimals))) / 1e18;
      const inputValue = entry?.source === "usd" ? entry.usd : usdValue.toFixed(2);
      return {
        address: asset.address,
        symbol: asset._symbol,
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
  }, [autoAllocate, recommendedCollateral, potentialCollateral, customCollateralEntries]);

  const afterBorrowHF = useMemo(() => {
    if (!loans || requestedBorrow <= 0) return null;
    return calculateAfterBorrowHealthFactor(loans, requestedBorrow, selectedCollateral);
  }, [loans, requestedBorrow, selectedCollateral]);

  const ltvNow = useMemo(() => {
    const debt = Number(formatUnits(BigInt(loans?.totalAmountOwed || "0"), 18));
    const collateral = Number(formatUnits(BigInt(loans?.totalCollateralValueSupplied || "0"), 18));
    if (!collateral) return 0;
    return (debt / collateral) * 100;
  }, [loans?.totalAmountOwed, loans?.totalCollateralValueSupplied]);

  // TODO: replace with routed mechanism data once backend is available
  const routePreview = useMemo(() => {
    const total = requestedBorrow > 0 ? requestedBorrow : 0;
    const lendingAmount = Math.round(total * 0.4 * 100) / 100;
    const cdpAmount = Math.round((total - lendingAmount) * 100) / 100;
    return {
      lendingAmount,
      cdpAmount,
      lendingApr: Number(((loans?.interestRate || 0) / 100).toFixed(2)),
      cdpApr: 0,
      blendedApr: 0,
      cdpDebt: 0,
      cdpCollateralUsd: 0,
      liquidationAtEth: 0,
      swapPairs: 0,
      earnApr: 0,
      cdpCR: 0,
    };
  }, [requestedBorrow, loans?.interestRate]);

  const progressValue = useMemo(() => {
    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (max <= min) return 50;
    const clamped = Math.max(min, Math.min(max, targetHealthFactor));
    return ((clamped - min) / (max - min)) * 100;
  }, [sliderExtrema, targetHealthFactor]);

  const displayHealthFactor = useMemo(() => {
    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return targetHealthFactor;
    return Math.max(min, Math.min(max, targetHealthFactor));
  }, [sliderExtrema, targetHealthFactor]);

  const updateTargetHealthFactorFromClientX = (clientX: number) => {
    const barEl = healthBarRef.current;
    if (!barEl) return;
    const rect = barEl.getBoundingClientRect();
    if (rect.width <= 0) return;

    const min = Number(sliderExtrema.min);
    const max = Number(sliderExtrema.max);
    if (max <= min) return;

    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const next = min + ratio * (max - min);
    setTargetHealthFactor(Number(next.toFixed(2)));
  };

  useEffect(() => {
    if (!isDraggingHealthBar) return;

    const handleMouseMove = (event: MouseEvent) => {
      updateTargetHealthFactorFromClientX(event.clientX);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      updateTargetHealthFactorFromClientX(touch.clientX);
    };

    const stopDragging = () => {
      setIsDraggingHealthBar(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", stopDragging);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", stopDragging);
    };
  }, [isDraggingHealthBar, sliderExtrema]);

  const handleBorrowNow = async () => {
    if (guestMode) return;
    if (requestedBorrowWei <= 0n) {
      setInlineBorrowError("Enter a borrow amount greater than zero");
      return;
    }
    if (requestedBorrowWei > availableToBorrow) {
      setInlineBorrowError("Borrow amount exceeds available limit");
      return;
    }

    setInlineBorrowError("");
    try {
      setBorrowLoading(true);
      for (const [collateral, amount] of selectedCollateral.entries()) {
        if (amount <= 0n) continue;
        await supplyCollateral({ asset: collateral.address, amount: amount.toString() });
      }
      if (requestedBorrowWei >= availableToBorrow && availableToBorrow > 0n) {
        await borrowMax();
      } else {
        await borrowAsset({ amount: requestedBorrowWei.toString() });
      }
      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${requestedBorrow.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USDST`,
        variant: "success",
      });
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
      setBorrowInput("");
      setSelectedBorrowPreset(null);
    } catch (error) {
      // Error toast is handled globally by axios interceptor
    } finally {
      setBorrowLoading(false);
    }
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
                          setBorrowInput(value);
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
                      disabled={guestMode || availableToBorrow <= 0n}
                      onClick={() => {
                        const percentAmount = Number(formatUnits(availableToBorrow, 18)) * (percent / 100);
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
                    disabled={guestMode || availableToBorrow <= 0n}
                    onClick={() => {
                      setBorrowInput(Number(formatUnits(availableToBorrow, 18)).toFixed(2));
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
              <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">YOUR COLLATERAL</p>
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
                {collateralRows.length > 0 ? (
                  collateralRows.map((row) => {
                    const iconBg = row.symbol === "ETHST" ? "bg-slate-500/50" : row.symbol === "GOLDST" ? "bg-amber-500/60" : "bg-orange-600/50";
                    return (
                      <div key={row.symbol} className="flex items-center justify-between px-4 py-4 border-t border-border/50">
                        <div className="flex items-center gap-3">
                          <span className={`w-10 h-10 rounded-full ${iconBg} inline-flex items-center justify-center text-sm font-semibold`}>
                            {row.symbol.slice(0, 1)}
                          </span>
                          <div>
                          <p className={`font-medium ${row.muted ? "text-muted-foreground/70" : ""}`}>{row.symbol}</p>
                          <p className={`text-xs text-muted-foreground ${row.muted ? "opacity-70" : ""}`}>{row.balanceText}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          {row.manual ? (
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
                              {row.amountText ? (
                                <p className="font-semibold">{row.amountText}</p>
                              ) : null}
                              <p className={`text-xs text-muted-foreground ${row.muted ? "opacity-70" : ""}`}>{row.usedText}</p>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-4 py-6 border-t border-border/50 text-sm text-muted-foreground text-center">
                    No data found
                  </div>
                )}
                <div className="flex justify-between text-sm px-4 py-4 border-t border-border/50">
                  <span className="text-muted-foreground">Total collateral used</span>
                  <span className="font-semibold">
                    ${(Number(totalCollateralUsedWei) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
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
                    {getRiskLabel(targetHealthFactor)}
                  </span>
                  <span className="font-semibold">Health Factor: {displayHealthFactor.toFixed(1)}x</span>
                </div>
                <div
                  ref={healthBarRef}
                  className={`relative h-3 rounded-full overflow-hidden bg-muted/30 ${guestMode ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onMouseDown={(event) => {
                    if (guestMode) return;
                    setIsDraggingHealthBar(true);
                    updateTargetHealthFactorFromClientX(event.clientX);
                  }}
                  onTouchStart={(event) => {
                    if (guestMode) return;
                    const touch = event.touches[0];
                    if (!touch) return;
                    setIsDraggingHealthBar(true);
                    updateTargetHealthFactorFromClientX(touch.clientX);
                  }}
                >
                  <div className="h-full w-full bg-gradient-to-r from-red-500 via-yellow-400 to-emerald-500" />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-white shadow-sm pointer-events-none"
                    style={{ left: `${Math.max(2, Math.min(98, progressValue))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Liquidation</span>
                  <span>Risky</span>
                  <span>Healthy</span>
                  <span>Safe</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">LTV</p>
                    <p className="font-semibold">{ltvNow.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Blended Rate</p>
                    <p className="font-semibold">{routePreview.blendedApr.toFixed(2)}% APR</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground text-xs">Liquidation At</p>
                    <p className="font-semibold">${routePreview.liquidationAtEth.toLocaleString()} ETH</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              className="w-full h-12 text-base"
              disabled={guestMode || borrowLoading || requestedBorrowWei <= 0n || requestedBorrowWei > availableToBorrow}
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
                  <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase font-semibold">BORROW ROUTED ACROSS 2 MECHANISMS</p>
                </div>
                <Card className="border-0 shadow-none bg-transparent">
                  <CardContent className="p-4 md:p-5 space-y-0 rounded-xl border border-border/70 bg-card dark:bg-[#1f274f]">
                    <div className="py-3 min-h-[86px] flex items-center justify-between border-b border-border/60">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 text-primary" />
                        <div>
                        <p className="font-medium">Lending Pool</p>
                        <p className="text-xs text-muted-foreground">{routePreview.lendingApr.toFixed(2)}% APR</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{routePreview.lendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST</p>
                        <p className="text-xs text-emerald-500">{(afterBorrowHF ?? loans?.healthFactor ?? 2.6).toFixed(1)}x</p>
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
                        <p className="font-semibold">{routePreview.cdpAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST</p>
                        <p className="text-xs text-emerald-500">CR {routePreview.cdpCR}%</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-border/60">
                      <p className="text-right text-sm font-semibold text-emerald-500">Blended rate (weighted): {routePreview.blendedApr.toFixed(2)}% APR</p>
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
                        <Button variant="outline" size="sm" className="mt-2">Repay</Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] p-3 min-h-[94px] flex items-center justify-between">
                      <div>
                        <p className="font-medium">CDP Vault - GOLDST</p>
                        <p className="text-xs text-muted-foreground">Collateral ${routePreview.cdpCollateralUsd.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{routePreview.cdpDebt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDST</p>
                        <Button variant="outline" size="sm" className="mt-2">Repay</Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 dark:bg-[#1f274f] px-3 py-2 text-sm">
                      <span className="text-muted-foreground inline-flex items-center gap-2">
                        <CirclePlus className="h-4 w-4" />
                        Total debt across all positions
                      </span>
                      <span className="font-semibold">
                        {(Number(formatUnits(BigInt(loans?.totalAmountOwed || "0"), 18)) + routePreview.cdpDebt).toLocaleString(undefined, {
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
