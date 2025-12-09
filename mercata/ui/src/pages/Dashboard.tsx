import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import { Wallet, Coins, Shield, Banknote, Loader2, Trophy } from "lucide-react";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { usePendingRewards } from "@/hooks/usePendingRewards";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useNetBalance } from "@/hooks/useNetBalance";
import MyPoolParticipationSection from "@/components/dashboard/MyPoolParticipationSection";
import PortfolioValueChart from "@/components/dashboard/PortfolioValueChart";
import { useLendingContext } from "@/context/LendingContext";
import { useCDP } from "@/context/CDPContext";
import { cataAddress, rewardsEnabled } from "@/lib/constants";
import { api } from "@/lib/axios";
import { BalanceSnapshot } from "@mercata/shared-types";
import { useUserLeaderboardRank } from "@/hooks/useUserLeaderboardRank";
import { Button } from "@/components/ui/button";

const TIME_RANGES = ["1d", "7d", "1m", "3m", "6m", "1y", "all"] as const;
type TimeRange = typeof TIME_RANGES[number];

type TabType = 'netBalance' | 'rewards' | 'borrowed';

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const {
    earningAssets,
    getEarningAssets,
    inactiveTokens,
    getInactiveTokens,
    getBalanceHistory,
    getCataBalanceHistory,
    getBorrowingHistory,
    loadingEarningAssets,
    loadingInactiveTokens,
    netBalanceHistoryCache,
    rewardsHistoryCache,
    borrowedHistoryCache,
    loadingBalanceHistory,
    setNetBalanceHistoryCache,
    setRewardsHistoryCache,
    setBorrowedHistoryCache,
    setLoadingBalanceHistory,
  } = useTokenContext();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const stored = localStorage.getItem('dashboard-activeTab');
    if (stored && ['netBalance', 'rewards', 'borrowed'].includes(stored)) {
      return stored as TabType;
    }
    return 'netBalance';
  });
  const { loans, refreshLoans } = useLendingContext();
  const { totalCDPDebt, refreshVaults } = useCDP();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>(() => {
    const stored = localStorage.getItem('dashboard-timeRange');
    if (stored && TIME_RANGES.includes(stored as TimeRange)) {
      return stored as TimeRange;
    }
    return '1d';
  });

  const { pendingRewards, refetch: refetchPendingRewards } = usePendingRewards(rewardsEnabled, 30000);
  const [isClaiming, setIsClaiming] = useState(false);
  const { rank: userRank, loading: rankLoading } = useUserLeaderboardRank();

  // Extract CATA token from inactive tokens by address
  const cataToken = useMemo(() => 
    inactiveTokens?.find(token => token.address === cataAddress),
    [inactiveTokens]
  );

  // Sort earning assets by value, then categorize in a single pass
  const { nonPoolTokens, poolTokens } = useMemo(() => {
    const sorted = [...earningAssets].sort((a, b) => {
      const valueA = parseFloat(a.value || "0");
      const valueB = parseFloat(b.value || "0");
      return valueB - valueA;
    });
    const nonPool: typeof earningAssets = [];
    const pool: typeof earningAssets = [];
    for (const token of sorted) {
      if (token.isPoolToken) {
        pool.push(token);
      } else {
        nonPool.push(token);
      }
    }
    return { nonPoolTokens: nonPool, poolTokens: pool };
  }, [earningAssets]);

  // Use centralized net balance calculation hook
  const { netBalance: totalBalance, cataBalance, totalBorrowed, isLoading: isLoadingNetBalance } = useNetBalance({
    tokens: earningAssets,
    cataToken,
    loans,
    totalCDPDebt
  });

  const chartConfig = useMemo(() => ({
    netBalance: {
      data: netBalanceHistoryCache[selectedTimeRange] || [],
      title: "Portfolio Value",
      subtitle: "Net balance over time",
      currentValue: totalBalance,
    },
    rewards: {
      data: rewardsHistoryCache[selectedTimeRange] || [],
      title: "Rewards",
      subtitle: "Reward Points over time",
      currentValue: cataBalance,
    },
    borrowed: {
      data: borrowedHistoryCache[selectedTimeRange] || [],
      title: "Borrowed",
      subtitle: "Total borrowed over time",
      currentValue: totalBorrowed,
    },
  }), [netBalanceHistoryCache, rewardsHistoryCache, borrowedHistoryCache, selectedTimeRange, totalBalance, cataBalance, totalBorrowed]);

  useEffect(() => {
    document.title = "Dashboard | STRATO";
    
    const hasExistingEarningAssets = earningAssets.length > 0;
    const hasExistingInactiveTokens = inactiveTokens.length > 0;
    
    getEarningAssets(!hasExistingEarningAssets);
    getInactiveTokens(!hasExistingInactiveTokens);
    refreshLoans();
    refreshVaults();
  }, [location.pathname, userAddress, getEarningAssets, getInactiveTokens, refreshLoans, refreshVaults]);

  useEffect(() => {
    localStorage.setItem('dashboard-activeTab', activeTab);
    localStorage.setItem('dashboard-timeRange', selectedTimeRange);
  }, [activeTab, selectedTimeRange]);

  const netBalanceCacheRef = useRef(netBalanceHistoryCache);
  const rewardsCacheRef = useRef(rewardsHistoryCache);
  const borrowedCacheRef = useRef(borrowedHistoryCache);

  useEffect(() => {
    netBalanceCacheRef.current = netBalanceHistoryCache;
    rewardsCacheRef.current = rewardsHistoryCache;
    borrowedCacheRef.current = borrowedHistoryCache;
  }, [netBalanceHistoryCache, rewardsHistoryCache, borrowedHistoryCache]);

  const prefetchOtherRanges = useCallback((primaryRange: TimeRange, tab: TabType) => {
    const rangesToPrefetch = TIME_RANGES.filter(range => range !== primaryRange);
    
    rangesToPrefetch.forEach(range => {
      (async () => {
        try {
          if (tab === 'netBalance') {
            if (netBalanceCacheRef.current[range]) return;
            const data = await getBalanceHistory(range, '');
            setNetBalanceHistoryCache(range, data);
          } else if (tab === 'rewards') {
            if (rewardsCacheRef.current[range]) return;
            const data = await getCataBalanceHistory(range, '');
            setRewardsHistoryCache(range, data);
          } else if (tab === 'borrowed') {
            if (borrowedCacheRef.current[range]) return;
            const data = await getBorrowingHistory(range, '');
            setBorrowedHistoryCache(range, data);
          }
        } catch (err) {
          // ignore background errors
        }
      })();
    });
  }, [getBalanceHistory, getCataBalanceHistory, getBorrowingHistory, setNetBalanceHistoryCache, setRewardsHistoryCache, setBorrowedHistoryCache]);

  const tabConfig = useMemo(() => ({
    netBalance: {
      fetchFn: getBalanceHistory,
      setCache: setNetBalanceHistoryCache,
    },
    rewards: {
      fetchFn: getCataBalanceHistory,
      setCache: setRewardsHistoryCache,
    },
    borrowed: {
      fetchFn: getBorrowingHistory,
      setCache: setBorrowedHistoryCache,
    },
  }), [getBalanceHistory, getCataBalanceHistory, getBorrowingHistory, setNetBalanceHistoryCache, setRewardsHistoryCache, setBorrowedHistoryCache]);

  useEffect(() => {
    let isMounted = true;

    const loadRange = async () => {
      const config = tabConfig[activeTab];
      const cache = activeTab === 'netBalance' 
        ? netBalanceCacheRef.current 
        : activeTab === 'rewards' 
        ? rewardsCacheRef.current 
        : borrowedCacheRef.current;
      const cached = cache[selectedTimeRange];
      
      if (cached && cached.length > 0) {
        setLoadingBalanceHistory(false);
        prefetchOtherRanges(selectedTimeRange, activeTab);
        
        (async () => {
          try {
            const data = await config.fetchFn(selectedTimeRange, '');
            if (isMounted) {
              config.setCache(selectedTimeRange, data);
            }
          } catch (err) {
            // ignore background errors
          }
        })();
        return;
      }

      setLoadingBalanceHistory(true);
      try {
        const data = await config.fetchFn(selectedTimeRange, '');
        if (!isMounted) return;
        config.setCache(selectedTimeRange, data);
      } catch (err) {
      } finally {
        if (isMounted) {
          setLoadingBalanceHistory(false);
          prefetchOtherRanges(selectedTimeRange, activeTab);
        }
      }
    };

    loadRange();

    return () => {
      isMounted = false;
    };
  }, [selectedTimeRange, activeTab, tabConfig, prefetchOtherRanges, setLoadingBalanceHistory]);

  const onTimeRangeChange = useCallback((duration: string) => {
    setSelectedTimeRange(duration as TimeRange);
  }, []);

  useEffect(() => {
    if (!searchParams) return;
    const successParam = searchParams.get("success");

    if (successParam !== "false" && successParam !== "true") return;

    if (successParam === "true") {
      toast?.({
        title: "Purchase Successful",
        description: "Your purchase was completed successfully.",
      });
      navigate("/dashboard", { replace: true });
    }
  }, [searchParams]);

  const handleClaimRewards = async () => {
    if (isClaiming || parseFloat(pendingRewards) <= 0) {
      return;
    }

    try {
      setIsClaiming(true);
      await api.post("/rewards/claim");

      toast?.({
        title: "Rewards Claimed",
        description: `Successfully claimed ${pendingRewards} CATA tokens!`,
      });

      // Refresh data after successful claim (silent refresh)
      await Promise.all([
        getEarningAssets(false),
        getInactiveTokens(false),
        refetchPendingRewards(),
      ]);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />

      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader 
          title="Overview" 
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="p-6">
          <div className={`grid grid-cols-1 ${rewardsEnabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-6 mb-8`}>
            <AssetSummary
              title="Net Balance"
              value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
              onClick={() => setActiveTab('netBalance')}
              isActive={activeTab === 'netBalance'}
              isLoading={isLoadingNetBalance}
            />

            <AssetSummary
              title="Rewards"
              value={`${cataBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} Reward Points`}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
              onClick={() => setActiveTab('rewards')}
              isActive={activeTab === 'rewards'}
              additionalContent={
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-700 font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate("/dashboard/rewards?tab=leaderboard");
                    }}
                  >
                    {rankLoading ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        Loading...
                      </>
                    ) : userRank !== null ? (
                      <>
                        <Trophy className="h-3.5 w-3.5 mr-1.5 text-yellow-500" />
                        Rank #{userRank} - View Leaderboard
                      </>
                    ) : (
                      "View Leaderboard"
                    )}
                  </Button>
                </div>
              }
            />

            {rewardsEnabled && (
              <AssetSummary
                title="Pending CATA"
                value={`${parseFloat(pendingRewards).toLocaleString("en-US", { maximumFractionDigits: 2 })} CATA`}
                icon={isClaiming ? <Loader2 className="text-white animate-spin" size={18} /> : <Banknote className="text-white" size={18} />}
                color={parseFloat(pendingRewards) > 0 ? "bg-green-500" : "bg-gray-500"}
                onClick={parseFloat(pendingRewards) > 0 && !isClaiming ? handleClaimRewards : undefined}
                tooltip={isClaiming ? "Processing claim..." : (parseFloat(pendingRewards) > 0 ? "Click to claim your rewards" : undefined)}
              />
            )}

            <AssetSummary
              title="Total Borrowed"
              value={`${totalBorrowed.toFixed(2)} USDST`}
              icon={<Shield className="text-white" size={18} />}
              color="bg-orange-500"
              onClick={() => setActiveTab('borrowed')}
              isActive={activeTab === 'borrowed'}
            />
          </div>

          {/* Portfolio Value Chart */}
          <div className="mb-8">
            <PortfolioValueChart 
              data={chartConfig[activeTab].data || []}
              onTimeRangeChange={onTimeRangeChange}
              selectedTimeRange={selectedTimeRange}
              isLoading={loadingBalanceHistory}
              tabType={activeTab}
              title={chartConfig[activeTab].title}
              subtitle={chartConfig[activeTab].subtitle}
              currentValue={chartConfig[activeTab].currentValue}
            />
          </div>

          <div className="mb-8">
            <AssetsList 
              loading={loadingEarningAssets || loadingInactiveTokens} 
              tokens={nonPoolTokens} 
              inActiveTokens={inactiveTokens} 
            />
          </div>

          <div className="mb-8">
            <BorrowingSection 
              loanData={loans}
            />
          </div>

          <div className="mb-8">
            <MyPoolParticipationSection 
              poolTokens={poolTokens}
              loading={loadingEarningAssets || loadingInactiveTokens}
            />
          </div>

          <div className="mb-8">
            <DashboardFAQ />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

