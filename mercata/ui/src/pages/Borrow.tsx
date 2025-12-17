import { useEffect, useMemo, useState } from "react";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CollateralData } from "@/interface";
import PositionSection from "@/components/Positions";
import CollateralModal from "@/components/borrow/CollateralModal";
import { WITHDRAW_COLLATERAL_FEE, SUPPLY_COLLATERAL_FEE } from "@/lib/constants";
import BorrowForm from "@/components/borrow/BorrowForm";
import RepayForm from "@/components/borrow/RepayForm";
import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";
import BorrowProgressModal, { StepStatus } from "@/components/borrow/BorrowProgressModal";
import { useSmartPolling } from "@/hooks/useSmartPolling";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
// NOTE: deposit amount validation is handled locally to allow 0/empty planned deposits

const Borrow = () => {
  const { userAddress } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "supply" | "withdraw" | null;
  }>({ isOpen: false, type: null });
  const [modalLoading, setModalLoading] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [repayLoading, setRepayLoading] = useState(false);
  const [borrowSteps, setBorrowSteps] = useState<Array<{ id: string; label: string; status: StepStatus; asset?: CollateralData; amount?: string; error?: string }>>([]);
  const [showBorrowProgress, setShowBorrowProgress] = useState(false);
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
    shouldPoll: () => true,
    interval: 10000,
    onError: (error) => console.error("Balance polling error:", error)
  });

  useEffect(() => {
    document.title = "Borrow Assets | STRATO";
  }, []);


  // Refresh data when page loads
  useEffect(() => {
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
  }, [userAddress, refreshLoans, refreshCollateral, fetchUsdstBalance]);


  const handleSupply = (asset) => {
    setSelectedAsset(asset);
    setModalState({ isOpen: true, type: "supply" });
  };

  const handleWithdraw = (asset) => {
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


  const executeEmbeddedBorrow = async (amount: string, requiredCollateral?: Array<{ asset: CollateralData; amount: string }>): Promise<boolean> => {
    try {
      setBorrowLoading(true);
      
      // Initialize steps for progress modal
      const steps: Array<{ id: string; label: string; status: StepStatus; asset?: CollateralData; amount?: string; error?: string }> = [];
      
      // Add collateral supply steps
      if (requiredCollateral && requiredCollateral.length > 0) {
        requiredCollateral.forEach((item, index) => {
          steps.push({
            id: `supply-${index}`,
            label: `Supply ${item.asset._symbol}`,
            status: "pending",
            asset: item.asset,
            amount: item.amount,
          });
        });
      }
      
      // Add borrow step
      steps.push({
        id: "borrow",
        label: `Borrow ${amount === 'ALL' ? 'Max' : amount} USDST`,
        status: "pending",
      });
      
      setBorrowSteps(steps);
      setShowBorrowProgress(true);
      
      // Deposit required collateral first if specified
      if (requiredCollateral && requiredCollateral.length > 0) {
        const feeWei = safeParseUnits(SUPPLY_COLLATERAL_FEE);
        const usdstWei = BigInt(usdstBalance || "0");
        const voucherWei = BigInt(voucherBalance || "0");
        const totalFeeNeeded = feeWei * BigInt(requiredCollateral.length);
        
        if ((usdstWei + voucherWei) < totalFeeNeeded) {
          toast({
            title: "Insufficient balance for deposit fees",
            description: `You need ${formatUnits(totalFeeNeeded, 18)} USDST + vouchers to pay for ${requiredCollateral.length} collateral deposit transaction${requiredCollateral.length > 1 ? 's' : ''}.`,
            variant: "destructive",
          });
          setBorrowLoading(false);
          setShowBorrowProgress(false);
          return false;
        }

        // Deposit each required collateral asset
        for (let i = 0; i < requiredCollateral.length; i++) {
          const item = requiredCollateral[i];
          const stepId = `supply-${i}`;
          
          // Update step to processing
          setBorrowSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, status: "processing" } : step
          ));
          
          try {
            const supplyWei = safeParseUnits(item.amount, item.asset.customDecimals ?? 18);
            if (supplyWei > 0n) {
              await supplyCollateral({
                asset: item.asset.address,
                amount: supplyWei.toString(),
              });
              
              // Update step to completed
              setBorrowSteps(prev => prev.map(step => 
                step.id === stepId ? { ...step, status: "completed" } : step
              ));
            }
          } catch (error) {
            // Update step to error
            setBorrowSteps(prev => prev.map(step => 
              step.id === stepId ? { 
                ...step, 
                status: "error",
                error: error instanceof Error ? error.message : "Failed to supply collateral"
              } : step
            ));
            setBorrowLoading(false);
            return false;
          }
        }
        
        // Refresh data after deposits
        await Promise.all([
          refreshLoans(),
          refreshCollateral(),
          fetchUsdstBalance(),
        ]);
      }

      // Update borrow step to processing
      setBorrowSteps(prev => prev.map(step => 
        step.id === "borrow" ? { ...step, status: "processing" } : step
      ));

      // Now execute the borrow
      try {
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
        
        // Update borrow step to completed
        setBorrowSteps(prev => prev.map(step => 
          step.id === "borrow" ? { ...step, status: "completed" } : step
        ));
      } catch (error) {
        // Update borrow step to error
        setBorrowSteps(prev => prev.map(step => 
          step.id === "borrow" ? { 
            ...step, 
            status: "error",
            error: error instanceof Error ? error.message : "Failed to borrow"
          } : step
        ));
        setBorrowLoading(false);
        return false;
      }
      
      setBorrowLoading(false);
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(),
      ]);
      
      // Keep modal open for a moment to show completion, then auto-close
      setTimeout(() => {
        setShowBorrowProgress(false);
        setBorrowSteps([]);
      }, 2000);
      
      return true;
    } catch (error) {
      setBorrowLoading(false);
      setShowBorrowProgress(false);
      return false;
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

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Borrow" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
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
                      collateralInfo={collateralInfo}
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

            {/* Right Column - Your Position */}
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
        </main>
      </div>


      {modalState.isOpen && modalState.type && (
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

      <BorrowProgressModal
        open={showBorrowProgress}
        steps={borrowSteps}
        onClose={() => {
          setShowBorrowProgress(false);
          setBorrowSteps([]);
        }}
      />

    </div>
  );
};

export default Borrow;
