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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import GuestSignInBanner from '@/components/ui/GuestSignInBanner';

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
  const [activeTab, setActiveTab] = useState<"borrow" | "repay">("borrow");
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

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

  const guestMode = !isLoggedIn;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Borrow" />

        <main className="p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to borrow USDST" />
          )}
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Left Column - Borrow/Repay Tabbed Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Borrow & Repay</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "borrow" | "repay")} className="w-full">
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
                      collateralInfo={collateralInfo}
                      startPolling={startPolling}
                      stopPolling={stopPolling}
                      userRewards={userRewards}
                      rewardsLoading={rewardsLoading}
                      guestMode={guestMode}
                    />
                  </TabsContent>
                  <TabsContent value="repay">
                    <RepayForm
                      loans={loans}
                      repayLoading={repayLoading}
                      onRepay={executeEmbeddedRepay}
                      usdstBalance={usdstBalance}
                      voucherBalance={voucherBalance}
                      guestMode={guestMode}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Right Column - Your Position (hidden for guests) and Collateral Management */}
            <div className="space-y-6">
              {!guestMode && (
                <PositionSection loanData={loans} userCollaterals={collateralInfo} />
              )}
              <CollateralManagementTable
                collateralInfo={collateralInfo}
                loadingCollateral={loadingCollateral}
                loans={loans}
                onSupply={handleSupply}
                onWithdraw={handleWithdraw}
                guestMode={guestMode}
              />
            </div>
          </div>

          {!guestMode && modalState.isOpen && modalState.type && selectedAsset && (
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
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Borrow;
