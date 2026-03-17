import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CircleArrowDown, CircleArrowUp, Waves, ArrowLeft } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidityDepositModal from "@/components/dashboard/LiquidityDepositModal";
import LiquidityWithdrawModal from "@/components/dashboard/LiquidityWithdrawModal";
import { useSwapContext } from "@/context/SwapContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import type { Pool } from "@/interface";
import { formatUnits } from "ethers";

const parseApy = (value: string | number | undefined): number => {
  if (!value || value === "-") return Number.NEGATIVE_INFINITY;
  const apy = Number(value);
  return Number.isFinite(apy) ? apy : Number.NEGATIVE_INFINITY;
};

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
  const { pools, poolsLoading, fetchPools } = useSwapContext();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { isLoggedIn } = useUser();

  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [isPoolDepositModalOpen, setIsPoolDepositModalOpen] = useState(false);
  const [isPoolWithdrawModalOpen, setIsPoolWithdrawModalOpen] = useState(false);
  const operationInProgressRef = useRef(false);

  useEffect(() => {
    document.title = "STRATO Earn Pools | STRATO";
    fetchPools();
    if (isLoggedIn) fetchUsdstBalance();
  }, [fetchPools, fetchUsdstBalance, isLoggedIn]);

  const highlightedPool = useMemo(() => {
    const search = new URLSearchParams(location.search);
    return search.get("pool")?.toLowerCase();
  }, [location.search]);

  const activePools = useMemo(
    () =>
      [...(pools || [])]
        .filter((pool) => !isPoolPaused(pool) && !isPoolDisabled(pool))
        .sort((a, b) => parseApy(b.apy) - parseApy(a.apy)),
    [pools]
  );
  const highlightedPoolData = useMemo(
    () => activePools.find((pool) => pool.address.toLowerCase() === highlightedPool),
    [activePools, highlightedPool]
  );

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
    await Promise.all([fetchPools(), isLoggedIn ? fetchUsdstBalance() : Promise.resolve()]);
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}>
        <DashboardHeader title="Liquidity Pools" />
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

          <Card className="border border-cyan-500/35 bg-gradient-to-br from-cyan-500/10 via-background to-blue-500/10">
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 mb-2">
                    <Waves className="h-4 w-4 text-cyan-500" />
                    <Badge variant="secondary">Pool Hub</Badge>
                  </div>
                  <h1 className="text-2xl md:text-3xl font-semibold">STRATO Liquidity Pools</h1>
                  <p className="text-sm text-muted-foreground mt-1">Single screen for APY, TVL, ratios, and pool actions.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Active Pools</p>
                    <p className="text-sm font-semibold">{activePools.length}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {poolsLoading ? (
            <Skeleton className="h-72 w-full rounded-xl" />
          ) : activePools.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">No active liquidity pools available.</CardContent>
            </Card>
          ) : !highlightedPoolData ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Pool details unavailable. Please open this page from a pool row in Earn.
              </CardContent>
            </Card>
          ) : (
            <Card className="border border-cyan-500/35 bg-gradient-to-br from-cyan-500/10 via-background to-blue-500/10">
              <CardContent className="pt-6 space-y-5">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <TokenPairIcon pool={highlightedPoolData} />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Selected Pool</p>
                      <h2 className="text-xl md:text-2xl font-semibold truncate">{highlightedPoolData.poolName}</h2>
                      <p className="text-sm text-muted-foreground truncate">{`Earn fees on ${highlightedPoolData.poolName.replace(" Pool", "")} swaps`}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {highlightedPoolData.isStable ? "Stable" : "Volatile"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      APY {formatPct(highlightedPoolData.apy)}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Your Liquidity</p>
                    <p className="text-sm font-semibold">
                      $
                      {formatUsd(
                        (
                          (safeBigInt(highlightedPoolData.lpToken?.totalBalance) * safeBigInt(highlightedPoolData.lpToken?.price)) /
                          WAD
                        ).toString()
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Your LP Tokens</p>
                    <p className="text-sm font-semibold">{formatLpTokenAmount(highlightedPoolData.lpToken?.totalBalance)}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Pool TVL</p>
                    <p className="text-sm font-semibold">${formatUsd(highlightedPoolData.totalLiquidityUSD)}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">24h Volume</p>
                    <p className="text-sm font-semibold">${formatUsd(highlightedPoolData.tradingVolume24h || "0")}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">A to B Ratio</p>
                    <p className="text-sm font-semibold">{formatRatio(highlightedPoolData.aToBRatio)}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">B to A Ratio</p>
                    <p className="text-sm font-semibold">{formatRatio(highlightedPoolData.bToARatio)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" onClick={() => handlePoolDeposit(highlightedPoolData)} disabled={!isLoggedIn}>
                    <CircleArrowDown className="h-4 w-4 mr-1" />
                    Deposit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePoolWithdraw(highlightedPoolData)}
                    disabled={!isLoggedIn || safeBigInt(highlightedPoolData.lpToken?.totalBalance) === 0n}
                  >
                    <CircleArrowUp className="h-4 w-4 mr-1" />
                    Withdraw
                  </Button>
                </div>
              </CardContent>
            </Card>
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
