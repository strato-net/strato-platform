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
import { Card, CardContent } from "@/components/ui/card";
import { CollateralData } from "@/interface";
import PositionSection from "@/components/Positions";
import CollateralModal from "@/components/borrow/CollateralModal";
import { WITHDRAW_COLLATERAL_FEE, SUPPLY_COLLATERAL_FEE } from "@/lib/constants";
import BorrowForm from "@/components/borrow/BorrowForm";
import RepayForm from "@/components/borrow/RepayForm";
import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";
import { useSmartPolling } from "@/hooks/useSmartPolling";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

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

  const { startPolling, stopPolling } = useSmartPolling({
    fetchFn: fetchUsdstBalance,
    shouldPoll: () => true,
    interval: 10000,
    onError: (error) => console.error("Balance polling error:", error)
  });

  useEffect(() => {
    document.title = "Borrow Assets | STRATO";
  }, []);

  useEffect(() => {
    const refreshData = async () => {
      try {
        await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
      } catch (error) {
        console.error("Error refreshing data:", error);
      }
    };
    refreshData();
  }, [userAddress, refreshLoans, refreshCollateral, fetchUsdstBalance]);

  useEffect(() => {
    if (collateralInfo && Array.isArray(collateralInfo)) {
      const eligibleWithBalance = collateralInfo.filter((item) => BigInt(item.userBalance || 0) > 0n);
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
      await supplyCollateral({ asset: asset.address, amount: safeParseUnits(amount).toString() });
      toast({ title: "Supply Initiated", description: `You supplied ${amount} ${asset._symbol}`, variant: "success" });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
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
        await withdrawCollateral({ asset: asset.address, amount: safeParseUnits(amount).toString() });
      }
      toast({ title: "Withdraw Initiated", description: `Withdrawal submitted: ${amount === 'ALL' ? 'max available' : amount} ${asset._symbol}`, variant: "success" });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
    }
  };

  const executeEmbeddedBorrow = async (amount: string) => {
    try {
      setBorrowLoading(true);
      if (amount === 'ALL') {
        await borrowMax();
        toast({ title: "Borrow Initiated", description: `Borrowed max available USDST`, variant: "success" });
      } else {
        await borrowAssetFn({ amount: safeParseUnits(amount).toString() });
        toast({ title: "Borrow Initiated", description: `You borrowed ${amount} USDST`, variant: "success" });
      }
      setBorrowLoading(false);
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      setBorrowLoading(false);
    }
  };

  const executeEmbeddedRepay = async (amount: string) => {
    try {
      setRepayLoading(true);
      if (amount === 'ALL') {
        const res = await repayAll();
        const sent = res?.estimatedDebtAtRead ? formatUnits(BigInt(res.estimatedDebtAtRead)) : 'all';
        toast({ title: "Success", description: `Successfully repaid ${sent} USDST`, variant: "success" });
      } else {
        const res = await repayLoanFn({ amount: safeParseUnits(amount).toString() } as any);
        const sent = res?.amountSent ? formatUnits(BigInt(res.amountSent)) : amount;
        toast({ title: "Success", description: `Successfully repaid ${sent} USDST`, variant: "success" });
      }
      setRepayLoading(false);
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      console.error("Error repaying loan:", error);
      setRepayLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Borrow" />
        <main className="p-4 md:p-6 pb-20 md:pb-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-6">
            {/* Left Column - Borrow/Repay Card */}
            <Card className="shadow-sm rounded-xl">
              <CardContent className="pt-6">
                <h2 className="text-xl font-bold mb-4">Borrow & Repay</h2>
                
                {/* Underline Tabs - same as Deposits page */}
                <div className="flex border-b border-border mb-4 md:mb-6">
                  <button
                    onClick={() => setActiveTab("borrow")}
                    className={`flex-1 py-2 md:py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === "borrow"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Borrow
                  </button>
                  <button
                    onClick={() => setActiveTab("repay")}
                    className={`flex-1 py-2 md:py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === "repay"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Repay
                  </button>
                </div>

                {activeTab === "borrow" ? (
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
                ) : (
                  <RepayForm
                    loans={loans}
                    repayLoading={repayLoading}
                    onRepay={executeEmbeddedRepay}
                    usdstBalance={usdstBalance}
                    voucherBalance={voucherBalance}
                  />
                )}
              </CardContent>
            </Card>

            {/* Right Column - Your Position */}
            <div>
              <PositionSection loanData={loans} userCollaterals={collateralInfo} />
            </div>
          </div>

          <CollateralManagementTable
            collateralInfo={collateralInfo}
            loadingCollateral={loadingCollateral}
            loans={loans}
            onSupply={handleSupply}
            onWithdraw={handleWithdraw}
          />
        </main>
      </div>

      <MobileBottomNav />

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
    </div>
  );
};

export default Borrow;
