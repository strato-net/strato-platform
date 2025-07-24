import { useEffect, useState } from "react";
import { safeParseUnits } from "@/utils/numberUtils";
import { useToast } from "@/hooks/use-toast";
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
import SupplyCollateralModal from "@/components/borrow/SupplyCollateral";
import WithdrawCollateralModal from "@/components/borrow/WithdrawCollateral";
import BorrowForm from "@/components/borrow/BorrowForm";
import RepayForm from "@/components/borrow/RepayForm";
import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";


const Borrow = () => {
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [supplyLoading, setSupplyLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [repayLoading, setRepayLoading] = useState(false);
  const [eligibleCollateral, setEligibleCollateral] = useState<CollateralData[]>([]);

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
    repayLoan: repayLoanFn
  } = useLendingContext();


  useEffect(() => {
    document.title = "Borrow Assets | STRATO Mercata";
  }, []);


  // Refresh data when page loads and when userAddress changes
  useEffect(() => {
    if (userAddress) {
      const refreshData = async () => {
        try {
          await Promise.all([
            refreshLoans(),
            refreshCollateral(),
            fetchUsdstBalance(userAddress),
          ]);
        } catch (error) {
          console.error("Error refreshing data:", error);
        }
      };
      refreshData();
    }
  }, [userAddress, refreshLoans, refreshCollateral, fetchUsdstBalance]);

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
    setSelectedAsset(asset)
    setIsSupplyModalOpen(true)
  }

  const closeSupplyModal = () => {
    setSelectedAsset(null);
    setIsSupplyModalOpen(false);
  };

  const executeSupply = async (asset: CollateralData, amount: string) => {
    try {
      setSupplyLoading(true);
      await supplyCollateral({
        asset: asset.address,
        amount: safeParseUnits(amount, 18).toString(),
      });
      toast({
        title: "Supply Initiated",
        description: `You supplied ${amount} ${asset._symbol}`,
        variant: "success",
      });
      setSupplyLoading(false);
      setIsSupplyModalOpen(false);
      // Refresh all data after successful supply
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      console.log(error, "error");
      setSupplyLoading(false);
      setIsSupplyModalOpen(false);
      toast({
        title: "Supply Error",
        description: `Something went wrong - ${error?.message || "Please try again later."}`,
        variant: "destructive",
      });
    }
  };

    const handleWithdraw = (asset) => {
    setSelectedAsset(asset)
    setIsWithdrawModalOpen(true)
  }

  const closeWithdrawModal = () => {
    setSelectedAsset(null);
    setIsWithdrawModalOpen(false);
  };

  const executeWithdraw = async (asset: CollateralData, amount: string) => {
    try {
      setWithdrawLoading(true);
      await withdrawCollateral({
        asset: asset.address,
        amount: safeParseUnits(amount, 18).toString(),
      });
      toast({
        title: "Withdraw Initiated",
        description: `You withdrew ${amount} ${asset._symbol}`,
        variant: "success",
      });
      setWithdrawLoading(false);
      setIsWithdrawModalOpen(false);
      // Refresh all data after successful withdraw
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      console.log(error, "error");
      setWithdrawLoading(false);
      setIsWithdrawModalOpen(false);
      toast({
        title: "Withdraw Error",
        description: `Something went wrong - ${error?.message || "Please try again later."}`,
        variant: "destructive",
      });
    }
  };


  const executeEmbeddedBorrow = async (amount: string) => {
    try {
      setBorrowLoading(true);
      await borrowAssetFn({ amount: safeParseUnits(amount, 18).toString() });
      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${amount} USDST`,
        variant: "success",
      });
      setBorrowLoading(false);
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      setBorrowLoading(false);
      toast({
        title: "Borrow Error",
        description: `Something went wrong - ${error?.message || "Please try again later."}`,
        variant: "destructive",
      });
    }
  };

  const executeEmbeddedRepay = async (amount: string) => {
    try {
      setRepayLoading(true);
      const totalOwedWei = BigInt(loans?.totalAmountOwed || 0);
      let amountInWei = safeParseUnits(amount || "0", 18);
      
      if (amountInWei > totalOwedWei) {
        amountInWei = totalOwedWei;
      }

      await repayLoanFn({
        amount: amountInWei.toString(),
      });
      
      toast({
        title: "Success",
        description: `Successfully Repaid ${amount} USDST`,
        variant: "success",
      });
      
      setRepayLoading(false);
      
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      console.error("Error repaying loan:", error);
      toast({
        title: "Error",
        description: `Repay Error - ${error}`,
        variant: "destructive",
      });
      setRepayLoading(false);
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
                      borrowLoading={borrowLoading}
                      onBorrow={executeEmbeddedBorrow}
                      usdstBalance={usdstBalance}
                      collateralInfo={eligibleCollateral}
                    />
                  </TabsContent>
                  <TabsContent value="repay">
                    <RepayForm
                      loans={loans}
                      repayLoading={repayLoading}
                      onRepay={executeEmbeddedRepay}
                      usdstBalance={usdstBalance}
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


      <SupplyCollateralModal 
          supplyLoading={supplyLoading}
          asset={selectedAsset}
          loanData={loans}
          isOpen={isSupplyModalOpen}
          onClose={closeSupplyModal}
          onSupply={(amount) => executeSupply(selectedAsset, amount)}
          usdstBalance={usdstBalance}
      />

       <WithdrawCollateralModal 
          withdrawLoading={withdrawLoading}
          asset={selectedAsset}
          loanData={loans}
          isOpen={isWithdrawModalOpen}
          onClose={closeWithdrawModal}
          onWithdraw={(amount) => executeWithdraw(selectedAsset, amount)}
          usdstBalance={usdstBalance}
      />

    </div>
  );
};

export default Borrow;
