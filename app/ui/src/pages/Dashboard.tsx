import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import V3LiquiditySummary from "../components/dashboard/V3LiquiditySummary";
import { Wallet, Coins, Shield, Loader2, Trophy, Send, Book, ArrowRightLeft, Gem, Mail, Gift } from "lucide-react";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useNetBalance } from "@/hooks/useNetBalance";
import PortfolioValueChart from "@/components/dashboard/PortfolioValueChart";
import { cataAddress, rewardsEnabled } from "@/lib/constants";
import { useUserLeaderboardRank } from "@/hooks/useUserLeaderboardRank";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import { formatBalance, safeBigInt } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import LiquidationAlertBanner, { CDPLiquidationAlertBanner } from "@/components/ui/LiquidationAlertBanner";
import GuestPromoSection from "@/components/dashboard/GuestPromoSection";
import ContactInquiryModal from "@/components/contact/ContactInquiryModal";
import { useNetwork } from "@/context/NetworkContext";

const TIME_RANGES = ["7d", "1m", "3m", "6m", "1y", "all"] as const;
type TimeRange = typeof TIME_RANGES[number];

type TabType = 'netBalance' | 'rewards' | 'borrowed';

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userAddress, isLoggedIn } = useUser();
  const {
    earningAssets,
    inactiveTokens,
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
  const { contactEnabled } = useNetwork();
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>(() => {
    const stored = localStorage.getItem('dashboard-timeRange');
    if (stored && TIME_RANGES.includes(stored as TimeRange)) {
      return stored as TimeRange;
    }
    return '7d';
  });

  const { rank: userRank, totalEarned, loading: rankLoading } = useUserLeaderboardRank();
  const { userRewards: rewardsUserInfo } = useRewardsUserInfo();
  const communityBonusFormatted = useMemo(() => {
    const bonus = rewardsUserInfo?.bonusRewards;
    if (!bonus || safeBigInt(bonus) <= 0n) return null;
    const numeric = formatBalance(bonus, "points", 18, 18, 18)
      .replace(/\s*points?\s*$/i, "")
      .trim();
    return formatRoundedWithCommas(roundByMagnitude(numeric));
  }, [rewardsUserInfo?.bonusRewards]);

  // Extract CATA token from inactive tokens by address
  const cataToken = useMemo(() =>
    inactiveTokens?.find(token => token.address === cataAddress),
    [inactiveTokens]
  );

  // Use centralized net balance calculation hook
  const { netBalance: totalBalance, cataBalance, totalBorrowed, isLoading: isLoadingNetBalance } = useNetBalance({
    cataToken,
  });

  const showFullDashboard = isLoggedIn && (isLoadingNetBalance || totalBalance > 0);

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

    // Check if user just logged in and needs to be redirected back to claim page
    const claimReturnUrl = localStorage.getItem("claimReturnUrl");
    if (claimReturnUrl && isLoggedIn) {
      localStorage.removeItem("claimReturnUrl");
      navigate(claimReturnUrl, { replace: true });
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    localStorage.setItem('dashboard-activeTab', activeTab);
    localStorage.setItem('dashboard-timeRange', selectedTimeRange);
  }, [activeTab, selectedTimeRange]);

  const netBalanceCacheRef = useRef(netBalanceHistoryCache);
  const rewardsCacheRef = useRef(rewardsHistoryCache);
  const borrowedCacheRef = useRef(borrowedHistoryCache);
  const cacheTimestampsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    netBalanceCacheRef.current = netBalanceHistoryCache;
    rewardsCacheRef.current = rewardsHistoryCache;
    borrowedCacheRef.current = borrowedHistoryCache;
  }, [netBalanceHistoryCache, rewardsHistoryCache, borrowedHistoryCache]);

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
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    if (!isLoggedIn || !isDesktop) {
      setLoadingBalanceHistory(false);
      return;
    }

    let isMounted = true;

    const loadRange = async () => {
      const config = tabConfig[activeTab];
      const cache = activeTab === 'netBalance'
        ? netBalanceCacheRef.current
        : activeTab === 'rewards'
          ? rewardsCacheRef.current
          : borrowedCacheRef.current;
      const cacheKey = `${activeTab}:${selectedTimeRange}`;
      const cached = cache[selectedTimeRange];
      const cachedAt = cacheTimestampsRef.current[cacheKey] || 0;
      const isFresh = Date.now() - cachedAt < 10_000;

      if (cached && cached.length > 0 && isFresh) {
        setLoadingBalanceHistory(false);
        return;
      }

      setLoadingBalanceHistory(true);
      try {
        const data = await config.fetchFn(selectedTimeRange, '');
        if (!isMounted) return;
        config.setCache(selectedTimeRange, data);
        cacheTimestampsRef.current[cacheKey] = Date.now();
      } catch (err) {
      } finally {
        if (isMounted) {
          setLoadingBalanceHistory(false);
        }
      }
    };

    loadRange();

    return () => {
      isMounted = false;
    };
  }, [selectedTimeRange, activeTab, tabConfig, setLoadingBalanceHistory, isLoggedIn]);

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

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Portfolio" />

        <main className="p-4 md:p-6 pb-24 md:pb-6">
          <GuestPromoSection variant={!isLoggedIn ? 1 : (!isLoadingNetBalance && totalBalance === 0) ? 2 : 3} userRewards={rewardsUserInfo} />
          {showFullDashboard && <LiquidationAlertBanner />}
          {showFullDashboard && <CDPLiquidationAlertBanner />}
          {showFullDashboard && (
            <div className={`grid grid-cols-1 ${rewardsEnabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3 md:gap-6 mb-4 md:mb-8`}>
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
                value={(() => {
                  if (rankLoading) return "Loading...";
                  if (!totalEarned) return "0 pts";
                  const totalEarnedNum = parseFloat(totalEarned) / 1e18;
                  return `${totalEarnedNum.toLocaleString("en-US", { maximumFractionDigits: 2 })} pts`;
                })()}
                icon={<Coins className="text-white" size={18} />}
                color="bg-purple-500"
                onClick={() => setActiveTab('rewards')}
                isActive={activeTab === 'rewards'}
                isLoading={rankLoading}
                additionalContent={
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900 hover:border-blue-300 dark:hover:border-blue-700 text-blue-700 dark:text-blue-300 font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/dashboard/rewards?tab=leaderboard`);
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
                          Rank #{userRank} - Leaderboard
                        </>
                      ) : (
                        "View Leaderboard"
                      )}
                    </Button>
                    {communityBonusFormatted && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dashboard/rewards`);
                        }}
                        title={`Community bonus: +${communityBonusFormatted} pts — view on Rewards page`}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 whitespace-nowrap"
                      >
                        <Gift className="h-3.5 w-3.5" />
                        +{communityBonusFormatted} Bonus
                      </button>
                    )}
                  </div>
                }
              />

              <AssetSummary
                title="Total Borrowed"
                value={`${totalBorrowed.toFixed(2)} USDST`}
                icon={<Shield className="text-white" size={18} />}
                color="bg-orange-500"
                onClick={() => setActiveTab('borrowed')}
                isActive={activeTab === 'borrowed'}
              />
            </div>
          )}

          {/* Portfolio Value Chart - hidden on mobile and for guests */}
          {showFullDashboard && (
            <div className="mb-8 hidden md:block">
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
          )}

          {/* Quick Action Buttons */}
          {showFullDashboard && (
            <div className="mb-8 grid grid-cols-4 gap-2 md:gap-4">
              <Button
                onClick={() => navigate("/dashboard/deposits")}
                className="h-auto py-3 md:h-12 md:py-0 bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2"
              >
                <Wallet size={18} />
                <span className="text-xs md:text-sm">Fund</span>
              </Button>
              <Button
                onClick={() => navigate("/dashboard/swap")}
                className="h-auto py-3 md:h-12 md:py-0 bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2"
              >
                <ArrowRightLeft size={18} />
                <span className="text-xs md:text-sm">Trade</span>
              </Button>
              <Button
                onClick={() => navigate("/dashboard/borrow")}
                className="h-auto py-3 md:h-12 md:py-0 bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2"
              >
                <Book size={18} />
                <span className="text-xs md:text-sm">Borrow</span>
              </Button>
              <Button
                onClick={() => navigate("/dashboard/transfer")}
                className="h-auto py-3 md:h-12 md:py-0 bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2"
              >
                <Send size={18} />
                <span className="text-xs md:text-sm">Send</span>
              </Button>
            </div>
          )}

          {/* Physical Metals Deposit Banner (only when contact API is configured) */}
          {contactEnabled && (
            <div className="mb-8">
              <div className="bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border border-blue-200 dark:border-blue-800 rounded-xl p-4 md:p-5 hover:bg-blue-500/15 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-500 rounded-full p-1.5 shrink-0">
                      <Gem className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm md:text-base font-semibold text-foreground">Deposit Physical Gold & Silver</h3>
                      <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                        We are currently accepting gold and silver physical deposits for tokenizing into GOLDST and SILVST.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setContactModalOpen(true)}
                    className="inline-flex items-center justify-center gap-2 shrink-0 h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                  >
                    <Mail size={16} />
                    Contact Us
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="mb-8">
            <AssetsList
              loading={loadingEarningAssets || loadingInactiveTokens}
              tokens={earningAssets}
              inActiveTokens={isLoggedIn ? inactiveTokens : []}
              guestMode={!isLoggedIn}
            />
          </div>

          {/* V3 concentrated-liquidity holdings (NFT and legacy positions) — V2 LP
              tokens appear in the assets list above, but V3 positions aren't tokens;
              renders only when present. Non-position NFTs live on the NFTs page. */}
          <V3LiquiditySummary />
        </main>
      </div>

      <MobileBottomNav />
      {contactEnabled && (
        <ContactInquiryModal open={contactModalOpen} onOpenChange={setContactModalOpen} />
      )}
    </div>
  );
};

export default Dashboard;

