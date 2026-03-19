import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CircleArrowDown, CircleArrowUp, ArrowLeft, Landmark, Wallet, Gauge } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidityDepositModal from "@/components/dashboard/LiquidityDepositModal";
import LiquidityWithdrawModal from "@/components/dashboard/LiquidityWithdrawModal";
import { useSwapContext } from "@/context/SwapContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import type { Pool } from "@/interface";
import { formatUnits } from "ethers";

const WAD = BigInt("1000000000000000000");

const formatUsd = (value: string): string => {
  try {
    return Number(formatUnits(value || "0", 18)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const formatPct = (value: string | number | undefined): string => {
  if (value === undefined || value === null || value === "-" || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(2)}%`;
};

const formatRatio = (value: string | undefined): string => {
  if (!value) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(6);
};

const isPoolDisabled = (pool: Pool): boolean => Boolean((pool as any).isDisabled);
const isPoolPaused = (pool: Pool): boolean => Boolean((pool as any).isPaused);

const safeBigInt = (value: string | number | bigint | undefined | null): bigint => {
  if (value === undefined || value === null) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const formatLpTokenAmount = (value: string | number | bigint | undefined): string => {
  try {
    return Number(formatUnits(safeBigInt(value), 18)).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  } catch {
    return "0";
  }
};

const TokenPairIcon = ({ pool }: { pool: Pool }) => (
  <div className="flex items-center -space-x-2 shrink-0">
    {pool.tokenA?.images?.[0]?.value ? (
      <img src={pool.tokenA.images[0].value} alt={pool.tokenA._symbol} className="w-8 h-8 rounded-full border-2 border-background object-cover" />
    ) : (
      <div className="w-8 h-8 rounded-full border-2 border-background bg-blue-500/20 flex items-center justify-center text-[10px] font-semibold">
        {(pool.tokenA?._symbol || "A").slice(0, 1)}
      </div>
    )}
    {pool.tokenB?.images?.[0]?.value ? (
      <img src={pool.tokenB.images[0].value} alt={pool.tokenB._symbol} className="w-8 h-8 rounded-full border-2 border-background object-cover" />
    ) : (
      <div className="w-8 h-8 rounded-full border-2 border-background bg-purple-500/20 flex items-center justify-center text-[10px] font-semibold">
        {(pool.tokenB?._symbol || "B").slice(0, 1)}
      </div>
    )}
  </div>
);

const EarnPools = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { getPoolByAddress } = useSwapContext();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { isLoggedIn } = useUser();

  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [selectedPoolData, setSelectedPoolData] = useState<Pool | null>(null);
  const [poolDetailsLoading, setPoolDetailsLoading] = useState(false);
  const [isPoolDepositModalOpen, setIsPoolDepositModalOpen] = useState(false);
  const [isPoolWithdrawModalOpen, setIsPoolWithdrawModalOpen] = useState(false);
  const operationInProgressRef = useRef(false);

  useEffect(() => {
    document.title = "STRATO Swap Pools | STRATO";
    if (isLoggedIn) fetchUsdstBalance();
  }, [fetchUsdstBalance, isLoggedIn]);

  const highlightedPool = useMemo(() => {
    const search = new URLSearchParams(location.search);
    return search.get("pool")?.toLowerCase();
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;

    const loadSelectedPool = async () => {
      if (!highlightedPool) {
        setSelectedPoolData(null);
        return;
      }

      setPoolDetailsLoading(true);
      try {
        const pool = await getPoolByAddress(highlightedPool);
        if (cancelled) return;

        const normalizedPool =
          pool && !isPoolPaused(pool) && !isPoolDisabled(pool) ? pool : null;
        setSelectedPoolData(normalizedPool);
      } finally {
        if (!cancelled) setPoolDetailsLoading(false);
      }
    };

    loadSelectedPool();
    return () => {
      cancelled = true;
    };
  }, [getPoolByAddress, highlightedPool]);

  const highlightedPoolData = selectedPoolData;
  const pageLoading = poolDetailsLoading;

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

  const handlePoolActionSuccess = async () => {
    await Promise.all([
      highlightedPool
        ? getPoolByAddress(highlightedPool).then((pool) => {
            const normalizedPool =
              pool && !isPoolPaused(pool) && !isPoolDisabled(pool) ? pool : null;
            setSelectedPoolData(normalizedPool);
          })
        : Promise.resolve(),
      isLoggedIn ? fetchUsdstBalance() : Promise.resolve(),
    ]);
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}>
        <DashboardHeader title="Swap Pools" />
        <main className="pb-16 md:pb-6 p-4 md:p-6 space-y-5">
          {!isLoggedIn && <GuestSignInBanner message="Sign in to deposit or withdraw liquidity from pools" />}

          <button
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => navigate("/dashboard/earn")}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Earn
          </button>

          <Card className="border border-border/70 bg-gradient-to-br from-blue-500/10 via-background to-background">
            <CardContent className="pt-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Earn Opportunity</p>
                  <h1 className="text-2xl md:text-3xl font-semibold mt-1">
                    {highlightedPoolData?.poolName || "Swap Pool"}
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Supply swap liquidity and withdraw on demand.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Pool APY</p>
                    <p className="text-sm font-semibold">
                      {pageLoading ? "Loading..." : highlightedPoolData ? formatPct(highlightedPoolData.apy) : "N/A"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">TVL</p>
                    <p className="text-sm font-semibold">
                      {pageLoading ? "Loading..." : highlightedPoolData ? `$${formatUsd(highlightedPoolData.totalLiquidityUSD)}` : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {!pageLoading && !highlightedPoolData ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Pool details unavailable. Please open this page from a pool row in Earn.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="xl:col-span-3 space-y-4">
                <Card className="border border-border/70">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold">Deposit</p>
                      <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Wallet className="h-3.5 w-3.5" />
                        {pageLoading
                          ? "Loading..."
                          : `${highlightedPoolData?.tokenA?._symbol || "Token A"} / ${highlightedPoolData?.tokenB?._symbol || "Token B"}`}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {pageLoading
                        ? "Loading pool details..."
                        : `Add liquidity to ${highlightedPoolData?.poolName || "this pool"} using the same swap pool deposit flow.`}
                    </p>
                    <div className="flex items-center justify-end">
                      <Button
                        onClick={() => highlightedPoolData && handlePoolDeposit(highlightedPoolData)}
                        className="h-11 sm:w-36"
                        disabled={!isLoggedIn || pageLoading || !highlightedPoolData}
                      >
                        <CircleArrowDown className="mr-2 h-4 w-4" />
                        Deposit
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-border/70">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold">Withdraw</p>
                      <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Gauge className="h-3.5 w-3.5" />
                        LP redemption
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Remove liquidity using your LP token balance for this pool.
                    </p>
                    <div className="text-sm text-muted-foreground">
                      Withdrawable: {pageLoading ? "Loading..." : `${formatLpTokenAmount(highlightedPoolData?.lpToken?.totalBalance)} LP`}
                    </div>
                    <div className="flex items-center justify-end">
                      <Button
                        onClick={() => highlightedPoolData && handlePoolWithdraw(highlightedPoolData)}
                        variant="outline"
                        className="h-11 sm:w-36"
                        disabled={!isLoggedIn || pageLoading || !highlightedPoolData || safeBigInt(highlightedPoolData.lpToken?.totalBalance) === 0n}
                      >
                        <CircleArrowUp className="mr-2 h-4 w-4" />
                        Withdraw
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="xl:col-span-2">
                <Card className="border border-border/70 h-full">
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 text-blue-600" />
                        <p className="text-base font-semibold">Pool Stats</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {pageLoading ? "Loading..." : highlightedPoolData?.isStable ? "Stable" : "Volatile"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5">
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">Your Liquidity</p>
                        <p className="text-sm font-semibold">
                          {pageLoading
                            ? "Loading..."
                            : `$${formatUsd(
                                (
                                  (safeBigInt(highlightedPoolData?.lpToken?.totalBalance) * safeBigInt(highlightedPoolData?.lpToken?.price)) /
                                  WAD
                                ).toString()
                              )}`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">Your LP Tokens</p>
                        <p className="text-sm font-semibold">
                          {pageLoading ? "Loading..." : formatLpTokenAmount(highlightedPoolData?.lpToken?.totalBalance)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">Pool TVL</p>
                        <p className="text-sm font-semibold">
                          {pageLoading ? "Loading..." : `$${formatUsd(highlightedPoolData?.totalLiquidityUSD || "0")}`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">24h Volume</p>
                        <p className="text-sm font-semibold">
                          {pageLoading ? "Loading..." : `$${formatUsd(highlightedPoolData?.tradingVolume24h || "0")}`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">Pool APY</p>
                        <p className="text-sm font-semibold">
                          {pageLoading ? "Loading..." : formatPct(highlightedPoolData?.apy)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">A to B Ratio</p>
                        <p className="text-sm font-semibold">
                          {pageLoading ? "Loading..." : formatRatio(highlightedPoolData?.aToBRatio)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs text-muted-foreground">B to A Ratio</p>
                        <p className="text-sm font-semibold">
                          {pageLoading ? "Loading..." : formatRatio(highlightedPoolData?.bToARatio)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </main>
      </div>

      <MobileBottomNav />

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
    </div>
  );
};

export default EarnPools;
