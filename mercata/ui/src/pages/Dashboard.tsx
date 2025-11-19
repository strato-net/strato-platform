import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import { Wallet, Coins, Shield, Banknote, Loader2 } from "lucide-react";
import Icon1 from "@/assets/home/icon1.png";
import Icon2 from "@/assets/home/icon2.png";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useLendingMetrics } from "@/hooks/useLendingMetrics";
import { usePendingRewards } from "@/hooks/usePendingRewards";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatUnits } from "viem";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { useNetBalance } from "@/hooks/useNetBalance";
import MyPoolParticipationSection from "@/components/dashboard/MyPoolParticipationSection";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";
import { useCDP } from "@/context/CDPContext";
import { useSafetyContext } from "@/context/SafetyContext";
import { cataAddress, rewardsEnabled } from "@/lib/constants";
import { api } from "@/lib/axios";

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, loading, fetchTokens } = useUserTokens();
  const { 
    availableBorrowingPower, 
    currentBorrowed, 
    averageInterestRate, 
  } = useLendingMetrics();
  const { loans } = useLendingContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { loadingLiquidity, liquidityInfo, refreshLoans } = useLendingContext();

  const { totalCDPDebt } = useCDP();
  const { poolsLoading: loadingUserPools, userPools, fetchUserPositions } = useSwapContext();
  const { safetyInfo } = useSafetyContext();
  const { pendingRewards, refetch: refetchPendingRewards } = usePendingRewards(rewardsEnabled, 30000);
  const [isClaiming, setIsClaiming] = useState(false);

  // Extract CATA token from inactive tokens by address
  const cataToken = inactiveTokens?.find(token =>
    token.address === cataAddress
  );

  // Use centralized net balance calculation hook
  const { netBalance: totalBalance, cataBalance, totalBorrowed } = useNetBalance({
    tokens,
    cataToken,
    loans,
    liquidityInfo,
    totalCDPDebt,
    safetyInfo
  });


  // Add visibility states to prevent flashing
  const [isComponentMounted, setIsComponentMounted] = useState(false);
  const [isDataInitialized, setIsDataInitialized] = useState(false);

  useEffect(() => {
    document.title = "Dashboard | STRATO Mercata";
    
    // Set mounted state immediately to prevent flash
    setIsComponentMounted(true);
    
    // Remove the timeout to prevent loading flash
    fetchTokens();
    refreshLoans();
    fetchUserPositions();

    // Mark data as initialized after a brief delay to ensure proper rendering
    const initTimer = setTimeout(() => {
      setIsDataInitialized(true);
    }, 100);

    return () => clearTimeout(initTimer);
  }, [userAddress]);

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

  // Net balance calculation is now handled by the useNetBalance hook above

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

      // Refresh data after successful claim
      await Promise.all([
        fetchTokens(),
        refetchPendingRewards(),
      ]);
    } finally {
      setIsClaiming(false);
    }
  };

  // Don't render anything until component is properly mounted
  if (!isComponentMounted) {
    return null;
  }

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
          {/* Promotional Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Save Card */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 shadow-sm border border-blue-200">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0">
                  <img src={Icon1} alt="Save" className="w-16 h-16" />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-blue-700 mb-2">
                    Save 6% APY with Confidence
                  </h3>
                  <p className="text-gray-600">
                    Safe and Secure Savings
                  </p>
                </div>
              </div>
              <button className="w-full bg-yellow-500 hover:bg-yellow-600 text-blue-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                START SAVING
                <span>→</span>
              </button>
            </div>

            {/* Borrow Card */}
            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-2xl p-6 shadow-sm border border-red-200">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0">
                  <img src={Icon2} alt="Borrow" className="w-16 h-16" />
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-red-700 mb-2">
                    Borrow 80% Against Your Assets
                  </h3>
                  <p className="text-gray-600">
                    Advanced Strategies for higher returns
                  </p>
                </div>
              </div>
              <button className="w-full bg-yellow-500 hover:bg-yellow-600 text-red-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                START BORROWING
                <span>→</span>
              </button>
            </div>
          </div>

          <div className={`grid grid-cols-1 ${rewardsEnabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-6 mb-8`}>
            <AssetSummary
              title="Net Balance"
              value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
            />

            <AssetSummary
              title="Rewards"
              value={`${cataBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} CATA Points`}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
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
            />
          </div>

          {/* Only render lower sections after data initialization to prevent flash */}
          {isDataInitialized && (
            <>
              <div className="mb-8">
                <AssetsList 
                  loading={loading} 
                  tokens={tokens} 
                  inActiveTokens={inactiveTokens} 
                  shouldPreventFlash={true}
                />
              </div>

              <div className="mb-8">
                <BorrowingSection 
                  loanData={loans}
                />
              </div>

              <div className="mb-8">
                <MyPoolParticipationSection 
                  loadingUserPools={loadingUserPools} 
                  loadingLiquidity={loadingLiquidity} 
                  liquidityInfo={liquidityInfo} 
                  userPools={userPools}
                  shouldPreventFlash={true}
                  safetyInfo={safetyInfo}
                  loadingSafety={loading}
                /> 
              </div>

              <div className="mb-8">
                <DashboardFAQ />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

