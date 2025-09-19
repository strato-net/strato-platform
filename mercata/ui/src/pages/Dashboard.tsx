import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import { Wallet, Coins, Shield } from "lucide-react";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useLendingMetrics } from "@/hooks/useLendingMetrics";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatUnits } from "viem";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import MyPoolParticipationSection from "@/components/dashboard/MyPoolParticipationSection";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";
import { useCDP } from "@/context/CDPContext";

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
  const [totalBalance, setTotalBalance] = useState<number>(0)
  const [cataBalance, setCataBalance] = useState<number>(0);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { loadingLiquidity, liquidityInfo, refreshLoans } = useLendingContext();
 
  const { totalCDPDebt, loading: cdpLoading } = useCDP();
  const { poolsLoading: loadingUserPools, userPools, fetchUserPositions } = useSwapContext();


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

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;

    // Wait for CDP data to load before calculating
    if (cdpLoading) return;

    let total = 0;
    let cataTotal = 0;

    // Calculate token deposit values (exact same as AssetsList component)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";
      const rawCollateralBalance = token?.collateralBalance || "0";
      const name = token?._name || "";
      const symbol = token?._symbol || "";

      // Use exact same calculation as AssetsList component (line 186)
      if (rawPrice && (rawBalance || rawCollateralBalance)) {
        const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
        const balance = parseFloat(formatUnits(BigInt(rawBalance || 0), 18));
        const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance || 0), 18));
        
        // Same calculation as AssetsList: price * (balance + collateralBalance)
        const totalTokenValue = price * (balance + collateralBalance);
        total += totalTokenValue;

        if (name.toLowerCase().includes("cata") || symbol.toLowerCase().includes("cata")) {
          cataTotal += totalTokenValue;
        }
      }
    }

    // Add lending pool value (matching MyPoolParticipationSection display)
    if ((liquidityInfo?.withdrawable as any)?.withdrawValue) {
      const lendingPoolValue = parseFloat(formatUnits(BigInt((liquidityInfo.withdrawable as any).withdrawValue), 18));
      total += lendingPoolValue;
    }

    // Add LP token values (exact same as MyPoolParticipationSection formatValue function)
    if (userPools && userPools.length > 0) {
      userPools.forEach((userPool) => {
        if (userPool?.lpToken?.balance && userPool?.lpToken?.price) {
          // Use exact same formatValue logic as MyPoolParticipationSection (lines 31-39)
          const balance = parseFloat(formatUnits(BigInt(userPool.lpToken.balance), 18));
          const priceValue = parseFloat(formatUnits(BigInt(userPool.lpToken.price), 18));
          const lpTokenValue = balance * priceValue;
          total += lpTokenValue;
        }
      });
    }

    // Calculate total debt (BOTH lending pool debt AND CDP vault debt)
    const lendingPoolDebt = loans?.totalAmountOwed 
      ? parseFloat(formatUnits((() => { 
          try { 
            const bi = BigInt(loans.totalAmountOwed); 
            return bi <= 1n ? 0n : bi; 
          } catch { 
            return 0n; 
          } 
        })(), 18))
      : 0;

    // CDP vault debt
    const cdpDebt = totalCDPDebt
      ? parseFloat(formatUnits((() => {
          try {
            const bi = BigInt(totalCDPDebt);
            return bi <= 1n ? 0n : bi;
          } catch {
            return 0n;
          }
        })(), 18))
      : 0;

    // Net balance calculation includes both debt types
    const totalDebt = lendingPoolDebt + cdpDebt;
    const netBalance = total - totalDebt;
    
    setTotalBalance(netBalance);
    setCataBalance(cataTotal);
  }, [tokens, loans, liquidityInfo, userPools, totalCDPDebt, cdpLoading]);

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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <AssetSummary
              title="Net Balance"
              value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
            />

            <AssetSummary
              title="CATA Rewards"
              value={`${cataBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} CATA`}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
            />

            <AssetSummary
              title="Total Borrowed"
              value={(() => {
                const lendingDebt = loans?.totalAmountOwed 
                  ? parseFloat(formatUnits((() => { 
                      try { 
                        const bi = BigInt(loans.totalAmountOwed); 
                        return bi <= 1n ? 0n : bi; 
                      } catch { 
                        return 0n; 
                      } 
                    })(), 18))
                  : 0;
                
                const cdpDebt = totalCDPDebt
                  ? parseFloat(formatUnits((() => {
                      try {
                        const bi = BigInt(totalCDPDebt);
                        return bi <= 1n ? 0n : bi;
                      } catch {
                        return 0n;
                      }
                    })(), 18))
                  : 0;
                
                const total = lendingDebt + cdpDebt;
                return `${total.toFixed(2)} USDST`;
              })()}
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

