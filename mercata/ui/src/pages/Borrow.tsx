import { useEffect, useState } from "react";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollateralData } from "@/interface";
import PositionSection from "@/components/Positions";
import CollateralModal from "@/components/borrow/CollateralModal";
import { WITHDRAW_COLLATERAL_FEE, SUPPLY_COLLATERAL_FEE } from "@/lib/constants";
import BorrowForm from "@/components/borrow/BorrowForm";
import RepayForm from "@/components/borrow/RepayForm";
import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";
import { useSmartPolling } from "@/hooks/useSmartPolling";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { Button } from "@/components/ui/button";
import { LogIn, Coins, Shield, TrendingUp, Percent, ChevronRight } from "lucide-react";
import { useCDP } from "@/context/CDPContext";

const Borrow = () => {
  const { userAddress, isLoggedIn } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "supply" | "withdraw" | null;
  }>({ isOpen: false, type: null });
  const [modalLoading, setModalLoading] = useState(false);
  const [repayLoading, setRepayLoading] = useState(false);
  const [eligibleCollateral, setEligibleCollateral] = useState<CollateralData[]>([]);
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();
  const { cdpAssets, loadingAssets: loadingCdpAssets } = useCDP();

  const { toast } = useToast();
  const {
    refreshLoans,
    loans,
    borrowAsset: borrowAssetFn,
    collateralInfo,
    loadingCollateral,
    refreshCollateral,
    supplyCollateral,
    withdrawCollateral,
    repayLoan: repayLoanFn,
    repayAll,
    withdrawCollateralMax,
    borrowMax
  } = useLendingContext();

  // Use the new smart polling hook for balance updates
  const { startPolling, stopPolling } = useSmartPolling({
    fetchFn: fetchUsdstBalance,
    shouldPoll: () => isLoggedIn,
    interval: 10000,
    onError: (error) => console.error("Balance polling error:", error)
  });

  useEffect(() => {
    document.title = "Borrow Assets | STRATO";
  }, []);


  // Refresh data when page loads - only for logged-in users
  useEffect(() => {
    if (!isLoggedIn) return;
    
    const refreshData = async () => {
      try {
        await Promise.all([
          refreshLoans(),
          refreshCollateral(),
          fetchUsdstBalance(),
        ]);
      } catch (error) {
        console.error("Error refreshing data:", error);
      }
    };
    refreshData();
  }, [userAddress, isLoggedIn, refreshLoans, refreshCollateral, fetchUsdstBalance]);

    useEffect(() => {
    if (collateralInfo && Array.isArray(collateralInfo)) {
      // Only show assets that have a balance > 0
      const eligibleWithBalance = collateralInfo.filter((item) => 
        BigInt(item.userBalance || 0) > 0n
      );
      setEligibleCollateral(eligibleWithBalance);
    }
  }, [collateralInfo]);

  const handleSupply = (asset: CollateralData) => {
    setSelectedAsset(asset);
    setModalState({ isOpen: true, type: "supply" });
  };

  const handleWithdraw = (asset: CollateralData) => {
    setSelectedAsset(asset);
    setModalState({ isOpen: true, type: "withdraw" });
  };

  const closeModal = () => {
    setSelectedAsset(null);
    setModalState({ isOpen: false, type: null });
  };

  const executeSupply = async (asset: CollateralData, amount: string) => {
    try {
      setModalLoading(true);
      await supplyCollateral({
        asset: asset.address,
        amount: safeParseUnits(amount).toString(),
      });
      toast({
        title: "Supply Initiated",
        description: `You supplied ${amount} ${asset._symbol}`,
        variant: "success",
      });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Refresh all data after successful supply
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
      ]);
    } catch (error) {
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
    }
  };

  const executeWithdraw = async (asset: CollateralData, amount: string) => {
    try {
      setModalLoading(true);
      if (amount === 'ALL') {
        await withdrawCollateralMax({ asset: asset.address });
      } else {
        await withdrawCollateral({
          asset: asset.address,
          amount: safeParseUnits(amount).toString(),
        });
      }
      toast({
        title: "Withdraw Initiated",
        description: `Withdrawal submitted: ${amount === 'ALL' ? 'max available' : amount} ${asset._symbol}`,
        variant: "success",
      });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Refresh all data after successful withdraw
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
      ]);
    } catch (error) {
      console.log(error, "error");
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Error toast is now handled globally by axios interceptor
    }
  };


  const executeEmbeddedBorrow = async (amount: string) => {
    try {
      setBorrowLoading(true);
      if (amount === 'ALL') {
        await borrowMax();
        toast({
          title: "Borrow Initiated",
          description: `Borrowed max available USDST`,
          variant: "success",
        });
      } else {
        await borrowAssetFn({ amount: safeParseUnits(amount).toString() });
        toast({
          title: "Borrow Initiated",
          description: `You borrowed ${amount} USDST`,
          variant: "success",
        });
      }
      setBorrowLoading(false);
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
      ]);
    } catch (error) {
      setBorrowLoading(false);
      throw error;
    }
  };

  const executeEmbeddedRepay = async (amount: string) => {
    try {
      setRepayLoading(true);
      if (amount === 'ALL') {
        const res = await repayAll();
        const sent = res?.estimatedDebtAtRead ? formatUnits(BigInt(res.estimatedDebtAtRead)) : 'all';
        toast({
          title: "Success",
          description: `Successfully repaid ${sent} USDST`,
          variant: "success",
        });
      } else {
        const res = await repayLoanFn({ amount: safeParseUnits(amount).toString() } as any);
        const sent = res?.amountSent ? formatUnits(BigInt(res.amountSent)) : amount;
        toast({
          title: "Success",
          description: `Successfully repaid ${sent} USDST`,
          variant: "success",
        });
      }
      setRepayLoading(false);
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
      ]);
    } catch (error) {
      console.error("Error repaying loan:", error);
      setRepayLoading(false);
    }
  };

  const handleLogin = () => {
    const theme = localStorage.getItem('theme') || 'light';
    window.location.href = `/login?theme=${theme}`;
  };

  // Guest view component
  const GuestBorrowView = () => (
    <div className="space-y-6">
      {/* Hero Section */}
      <Card className="border-2 border-dashed bg-gradient-to-br from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mb-4 shadow-lg">
            <Coins className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-2xl">Borrow USDST Against Your Assets</CardTitle>
          <CardDescription className="text-base max-w-lg mx-auto">
            Use your deposited assets as collateral to borrow USDST instantly. 
            Flexible terms, competitive rates, no credit checks required.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          {/* Key Features */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
              <Shield className="w-8 h-8 text-blue-500" />
              <span className="font-medium">Secure Collateral</span>
              <span className="text-sm text-muted-foreground">Your assets stay safe</span>
            </div>
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
              <Percent className="w-8 h-8 text-green-500" />
              <span className="font-medium">Low Interest</span>
              <span className="text-sm text-muted-foreground">Competitive rates</span>
            </div>
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border">
              <TrendingUp className="w-8 h-8 text-purple-500" />
              <span className="font-medium">Instant Access</span>
              <span className="text-sm text-muted-foreground">Borrow immediately</span>
            </div>
          </div>
          
          <Button 
            onClick={handleLogin}
            size="lg"
            className="gap-2 px-8"
          >
            <LogIn className="w-5 h-5" />
            Sign In to Start Borrowing
            <ChevronRight className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Available Collateral Assets - Public Info */}
      <Card>
        <CardHeader>
          <CardTitle>Available Collateral Assets</CardTitle>
          <CardDescription>
            Assets you can use as collateral to borrow USDST
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCdpAssets ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : cdpAssets && cdpAssets.length > 0 ? (
            <div className="space-y-3">
              {cdpAssets.filter(a => a.isSupported).map((asset) => (
                <div key={asset.asset} className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center">
                      <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        {asset.symbol?.charAt(0) || '?'}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">{asset.symbol || 'Unknown'}</p>
                      <p className="text-sm text-muted-foreground">
                        {asset.asset?.slice(0, 6)}...{asset.asset?.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-green-600 dark:text-green-400">
                      LTV: {asset.ltv ? (Number(asset.ltv) / 100).toFixed(0) : '--'}%
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Liq. Threshold: {asset.liquidationThreshold ? (Number(asset.liquidationThreshold) / 100).toFixed(0) : '--'}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No collateral assets available at this time.</p>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );

  // Logged-in user view
  const AuthenticatedBorrowView = () => (
    <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Left Column - Borrow/Repay Tabbed Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Borrow & Repay</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="borrow" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="borrow">Borrow</TabsTrigger>
                    <TabsTrigger value="repay">Repay</TabsTrigger>
                  </TabsList>
                  <TabsContent value="borrow">
                    <BorrowForm
                      loans={loans}
                      borrowLoading={borrowLoading}
                      onBorrow={executeEmbeddedBorrow}
                      usdstBalance={usdstBalance}
                      voucherBalance={voucherBalance}
                      collateralInfo={eligibleCollateral}
                      startPolling={startPolling}
                      stopPolling={stopPolling}
                      userRewards={userRewards}
                      rewardsLoading={rewardsLoading}
                    />
                  </TabsContent>
                  <TabsContent value="repay">
                    <RepayForm
                      loans={loans}
                      repayLoading={repayLoading}
                      onRepay={executeEmbeddedRepay}
                      usdstBalance={usdstBalance}
                      voucherBalance={voucherBalance}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Right Column - Your Position and Collateral Management */}
            <div className="space-y-6">
              <PositionSection loanData={loans} userCollaterals={collateralInfo} />
              <CollateralManagementTable
                collateralInfo={collateralInfo}
                loadingCollateral={loadingCollateral}
                loans={loans}
                onSupply={handleSupply}
                onWithdraw={handleWithdraw}
              />
            </div>
      </div>

      {modalState.isOpen && modalState.type && selectedAsset && (
        <CollateralModal 
            type={modalState.type}
            loading={modalLoading}
            asset={selectedAsset}
            loanData={loans}
            isOpen={modalState.isOpen}
            onClose={closeModal}
            onAction={(amount) => {
              if (modalState.type === "supply") {
                executeSupply(selectedAsset, amount);
              } else if (modalState.type === "withdraw") {
                executeWithdraw(selectedAsset, amount);
              }
            }}
            usdstBalance={usdstBalance}
            voucherBalance={voucherBalance}
            transactionFee={modalState.type === "supply" ? SUPPLY_COLLATERAL_FEE : WITHDRAW_COLLATERAL_FEE}
        />
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Borrow" />

        <main className="p-4 md:p-6">
          {isLoggedIn ? <AuthenticatedBorrowView /> : <GuestBorrowView />}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Borrow;
