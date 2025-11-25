import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import { Wallet, Coins, Shield, Banknote, Loader2 } from "lucide-react";
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
    loadingInactiveTokens
  } = useTokenContext();
  const [activeTab, setActiveTab] = useState<TabType>('netBalance');
  const { loans, refreshLoans } = useLendingContext();
  const { totalCDPDebt, refreshVaults } = useCDP();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('1d');
  const [isLoadingBalanceHistory, setIsLoadingBalanceHistory] = useState(false);
  
  // Caches for different tabs
  const [balanceHistoryCache, setBalanceHistoryCache] = useState<Record<string, BalanceSnapshot[]>>({});
  const [cataBalanceHistoryCache, setCataBalanceHistoryCache] = useState<Record<string, BalanceSnapshot[]>>({});
  const [borrowedHistoryCache, setBorrowedHistoryCache] = useState<Record<string, BalanceSnapshot[]>>({});
  
  // Displayed data for current tab
  const [displayedBalanceHistory, setDisplayedBalanceHistory] = useState<BalanceSnapshot[]>([]);
  const [displayedCataBalanceHistory, setDisplayedCataBalanceHistory] = useState<BalanceSnapshot[]>([]);
  const [displayedBorrowedHistory, setDisplayedBorrowedHistory] = useState<BalanceSnapshot[]>([]);
  
  const balanceHistoryCacheRef = useRef<Record<string, BalanceSnapshot[]>>({});
  const cataBalanceHistoryCacheRef = useRef<Record<string, BalanceSnapshot[]>>({});
  const borrowedHistoryCacheRef = useRef<Record<string, BalanceSnapshot[]>>({});
  const hasPrefetchedRef = useRef<Record<TabType, boolean>>({ netBalance: false, rewards: false, borrowed: false });

  const { pendingRewards, refetch: refetchPendingRewards } = usePendingRewards(rewardsEnabled, 30000);
  const [isClaiming, setIsClaiming] = useState(false);

  // Extract CATA token from inactive tokens by address
  const cataToken = inactiveTokens?.find(token =>
    token.address === cataAddress
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
  const { netBalance: totalBalance, cataBalance, totalBorrowed } = useNetBalance({
    tokens: earningAssets,
    cataToken,
    loans,
    totalCDPDebt
  });

  useEffect(() => {
    document.title = "Dashboard | STRATO Mercata";
    
    const hasExistingEarningAssets = earningAssets.length > 0;
    const hasExistingInactiveTokens = inactiveTokens.length > 0;
    
    getEarningAssets(!hasExistingEarningAssets);
    getInactiveTokens(!hasExistingInactiveTokens);
    refreshLoans();
    refreshVaults();
  }, [location.pathname, userAddress, getEarningAssets, getInactiveTokens, refreshLoans, refreshVaults]);

  const setCacheForRange = useCallback((duration: TimeRange, data: BalanceSnapshot[], tab: TabType = 'netBalance') => {
    if (tab === 'netBalance') {
      setBalanceHistoryCache(prev => {
        const updated = { ...prev, [duration]: data };
        balanceHistoryCacheRef.current = updated;
        return updated;
      });
    } else if (tab === 'rewards') {
      const cataData = data as unknown as BalanceSnapshot[];
      setCataBalanceHistoryCache(prev => {
        const updated = { ...prev, [duration]: cataData };
        cataBalanceHistoryCacheRef.current = updated;
        return updated;
      });
    }
  }, []);

  const prefetchOtherRanges = useCallback((primaryRange: TimeRange, tab: TabType) => {
    if (hasPrefetchedRef.current[tab]) return;
    hasPrefetchedRef.current[tab] = true;
    const rangesToPrefetch = TIME_RANGES.filter(range => range !== primaryRange);
    
    rangesToPrefetch.forEach(range => {
      (async () => {
        try {
          if (tab === 'netBalance') {
            if (balanceHistoryCacheRef.current[range]) return;
            const data = await getBalanceHistory(range, '');
            setCacheForRange(range as TimeRange, data, 'netBalance');
          } else if (tab === 'rewards') {
            if (cataBalanceHistoryCacheRef.current[range]) return;
            const data = await getCataBalanceHistory(range, '');
            setCataBalanceHistoryCache(prev => {
              const updated = { ...prev, [range]: data };
              cataBalanceHistoryCacheRef.current = updated;
              return updated;
            });
          } else if (tab === 'borrowed') {
            if (borrowedHistoryCacheRef.current[range]) return;
            const data = await getBorrowingHistory(range, '');
            setBorrowedHistoryCache(prev => {
              const updated = { ...prev, [range]: data };
              borrowedHistoryCacheRef.current = updated;
              return updated;
            });
          }
        } catch (err) {
          // ignore background errors
        }
      })();
    });
  }, [getBalanceHistory, getCataBalanceHistory, getBorrowingHistory, setCacheForRange]);

  useEffect(() => {
    let isMounted = true;

    const loadRange = async () => {
      if (activeTab === 'netBalance') {
        const cached = balanceHistoryCacheRef.current[selectedTimeRange];
        if (cached && cached.length > 0) {
          setDisplayedBalanceHistory(cached);
          setIsLoadingBalanceHistory(false);
          prefetchOtherRanges(selectedTimeRange, 'netBalance');
          return;
        }

        setIsLoadingBalanceHistory(true);
        let shouldPrefetch = false;
        try {
          const data = await getBalanceHistory(selectedTimeRange, '');
          if (!isMounted) return;
          setCacheForRange(selectedTimeRange, data, 'netBalance');
          setDisplayedBalanceHistory(data);
          shouldPrefetch = true;
        } catch (err) {
        } finally {
          if (isMounted) {
            setIsLoadingBalanceHistory(false);
            if (shouldPrefetch) {
              prefetchOtherRanges(selectedTimeRange, 'netBalance');
            }
          }
        }
      } else if (activeTab === 'rewards') {
        const cached = cataBalanceHistoryCacheRef.current[selectedTimeRange];
        if (cached && cached.length > 0) {
          setDisplayedCataBalanceHistory(cached);
          setIsLoadingBalanceHistory(false);
          prefetchOtherRanges(selectedTimeRange, 'rewards');
          return;
        }

        setIsLoadingBalanceHistory(true);
        let shouldPrefetch = false;
        try {
          const data = await getCataBalanceHistory(selectedTimeRange, '');
          if (!isMounted) return;
          setCataBalanceHistoryCache(prev => {
            const updated = { ...prev, [selectedTimeRange]: data };
            cataBalanceHistoryCacheRef.current = updated;
            return updated;
          });
          setDisplayedCataBalanceHistory(data);
          shouldPrefetch = true;
        } catch (err) {
        } finally {
          if (isMounted) {
            setIsLoadingBalanceHistory(false);
            if (shouldPrefetch) {
              prefetchOtherRanges(selectedTimeRange, 'rewards');
            }
          }
        }
      } else if (activeTab === 'borrowed') {
        const cached = borrowedHistoryCacheRef.current[selectedTimeRange];
        if (cached && cached.length > 0) {
          setDisplayedBorrowedHistory(cached);
          setIsLoadingBalanceHistory(false);
          prefetchOtherRanges(selectedTimeRange, 'borrowed');
          return;
        }

        setIsLoadingBalanceHistory(true);
        const data = await getBorrowingHistory(selectedTimeRange, '');
        setBorrowedHistoryCache(prev => {
          const updated = { ...prev, [selectedTimeRange]: data };
          borrowedHistoryCacheRef.current = updated;
          return updated;
        });
        setDisplayedBorrowedHistory(data);
        setIsLoadingBalanceHistory(false);
        prefetchOtherRanges(selectedTimeRange, 'borrowed');
      }
    };

    loadRange();

    return () => {
      isMounted = false;
    };
  }, [selectedTimeRange, activeTab, getBalanceHistory, getCataBalanceHistory, getBorrowingHistory, prefetchOtherRanges, setCacheForRange]);

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
            />

            <AssetSummary
              title="Rewards"
              value={`${cataBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} CATA Points`}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
              onClick={() => setActiveTab('rewards')}
              isActive={activeTab === 'rewards'}
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
            {activeTab === 'netBalance' && (
              <PortfolioValueChart 
                data={(displayedBalanceHistory || [])}
                onTimeRangeChange={(duration) => {
                  setSelectedTimeRange(duration as TimeRange);
                }}
                selectedTimeRange={selectedTimeRange}
                isLoading={isLoadingBalanceHistory}
                tabType="netBalance"
                title="Portfolio Value"
                subtitle="Net balance over time"
                currentValue={totalBalance}
              />
            )}
            {activeTab === 'rewards' && (
              <PortfolioValueChart 
                data={(displayedCataBalanceHistory || [])}
                onTimeRangeChange={(duration) => {
                  setSelectedTimeRange(duration as TimeRange);
                }}
                selectedTimeRange={selectedTimeRange}
                isLoading={isLoadingBalanceHistory}
                tabType="rewards"
                title="Rewards"
                subtitle="CATA balance over time"
                currentValue={cataBalance}
              />
            )}
            {activeTab === 'borrowed' && (
              <PortfolioValueChart 
                data={(displayedBorrowedHistory || [])}
                onTimeRangeChange={(duration) => {
                  setSelectedTimeRange(duration as TimeRange);
                }}
                selectedTimeRange={selectedTimeRange}
                isLoading={isLoadingBalanceHistory}
                tabType="borrowed"
                title="Borrowed"
                subtitle="Total borrowed over time"
                currentValue={totalBorrowed}
              />
            )}
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

