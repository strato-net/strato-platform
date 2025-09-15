import { useEffect, useState, useCallback } from "react";
import { safeParseUnits } from "@/utils/numberUtils";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
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
import { useSmartPolling } from "@/hooks/useSmartPolling";

const Borrow = () => {
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "supply" | "withdraw" | null;
  }>({ isOpen: false, type: null });
  const [modalLoading, setModalLoading] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [eligibleCollateral, setEligibleCollateral] = useState<CollateralData[]>([]);

  const {
    refreshLoans,
    loans,
    collateralInfo,
    loadingCollateral,
    refreshCollateral,
    supplyCollateral,
    withdrawCollateral,
    withdrawCollateralMax
  } = useLendingContext();

  // Function to refresh all data
  const refetchData = useCallback(async () => {
    if (!userAddress) return;
    try {
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress),
      ]);
    } catch (error) {
      console.error("Error refreshing data:", error);
    }
  }, [userAddress, refreshLoans, refreshCollateral, fetchUsdstBalance]);

  // Automatic polling for loan data updates
  useSmartPolling({
    fetchFn: refetchData,
    shouldPoll: () => !!userAddress,
    interval: 15000, // 15 seconds - reasonable for loan data
    autoStart: true,
    enabled: !!userAddress,
    onError: (error) => console.error("Loan data polling error:", error)
  });

  useEffect(() => {
    document.title = "Borrow Assets | STRATO Mercata";
  }, []);


    useEffect(() => {
    if (collateralInfo && Array.isArray(collateralInfo)) {
      // Only show assets that have a balance > 0
      const eligibleWithBalance = collateralInfo.filter((item) => 
        BigInt(item.userBalance || 0) > 0n
      );
      setEligibleCollateral(eligibleWithBalance);
    }
  }, [collateralInfo])

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
        amount: safeParseUnits(amount, asset?.customDecimals ?? 18).toString(),
      });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Refresh all data after successful supply
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
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
          amount: safeParseUnits(amount, asset?.customDecimals ?? 18).toString(),
        });
      }
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Refresh all data after successful withdraw
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      console.log(error, "error");
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Error toast is now handled globally by axios interceptor
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
        <DashboardHeader title="Borrow" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Left Column - Borrow/Repay Tabbed Card */}
            <Card>
              <CardHeader>
                <CardTitle>Borrow & Repay</CardTitle>
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
                      usdstBalance={usdstBalance}
                      collateralInfo={eligibleCollateral}
                      onActionComplete={refetchData}
                    />
                  </TabsContent>
                  <TabsContent value="repay">
                    <RepayForm
                      loans={loans}
                      usdstBalance={usdstBalance}
                      onActionComplete={refetchData}
                    />
                  </TabsContent>
                </Tabs>
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
            transactionFee={modalState.type === "supply" ? SUPPLY_COLLATERAL_FEE : WITHDRAW_COLLATERAL_FEE}
        />
      )}

    </div>
  );
};

export default Borrow;
