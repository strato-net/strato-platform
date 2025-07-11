import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import BorrowAssetModal from "@/components/dashboard/BorrowAssetModal";
import RepayModal from "@/components/dashboard/RepayModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DepositableToken } from "@/interface";
import PositionSection from "@/components/Positions";
import SupplyCollateralModal from "@/components/SupplyCollateral";
import WithdrawCollateralModal from "@/components/WithdrawCollateral";

const LoadingSpinner = () => (
  <div className="flex justify-center items-center h-12">
    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
  </div>
);

const formatTokenAmount = (value: any) =>
  parseFloat(formatUnits(value || 0, 18)).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });


const BorrowNew = () => {
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const [selectedAsset, setSelectedAsset] = useState<DepositableToken | null>(null);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false)
  const [wrongAmount, setWrongAmount] = useState(false);
  const [eligibleCollateral, setEligibleCollateral] = useState([])
  const [suppliedCollateral, setSuppliedCollateral] = useState([])
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [supplyLoading, setSupplyLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);


  const { toast } = useToast();
  const {
    refreshLoans,
    loans,
    borrowAsset: borrowAssetFn,
    collateralInfo,
    loadingCollateral,
    refreshCollateral,
    supplyCollateral,
    withdrawCollateral
  } = useLendingContext();

  useEffect(() => {
    document.title = "Borrow Assets | STRATO Mercata";
  }, []);

  useEffect(() => {
    if (collateralInfo && Array.isArray(collateralInfo)) {
      const filtered = collateralInfo.filter((item) => item.collateralizedAmount > 0);
      setSuppliedCollateral(filtered);
      
      // Only show assets that have a balance > 0
      const eligibleWithBalance = collateralInfo.filter((item) => 
        BigInt(item.userBalance || 0) > 0n
      );
      setEligibleCollateral(eligibleWithBalance);
    }
  }, [collateralInfo])

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

  const handleBorrow = () => {
    setIsBorrowModalOpen(true);
  };
  
  const closeBorrowModal = () => {
    setIsBorrowModalOpen(false);
  };

  const executeBorrow = async (amount: string) => {
    try {
      setBorrowLoading(true);
      await borrowAssetFn({ amount: parseUnits(amount, 18).toString() });
      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${amount} USDST`,
        variant: "success",
      });
      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      // Refresh all data after successful borrow
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error: any) {
      console.log(error, "error");
      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      toast({
        title: "Borrow Error",
        description: `Something went wrong - ${error?.message || "Please try again later."}`,
        variant: "destructive",
      });
    }
  };
  
  const handleRepay = () => {
    setShowRepayModal(true);
  };

  const closeRepayModal = () => {
    setShowRepayModal(false)
  }
  

  const handleSupply = (asset) => {
    setSelectedAsset(asset)
    setIsSupplyModalOpen(true)
  }

  const closeSupplyModal = () => {
    setSelectedAsset(null);
    setIsSupplyModalOpen(false);
  };

  const executeSupply = async (asset: DepositableToken, amount: string) => {
    try {
      setSupplyLoading(true);
      await supplyCollateral({
        asset: asset.address,
        amount: parseUnits(amount, 18).toString(),
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
    } catch (error: any) {
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

  const executeWithdraw = async (asset: DepositableToken, amount: string) => {
    try {
      setWithdrawLoading(true);
      await withdrawCollateral({
        asset: asset.address,
        amount: parseUnits(amount, 18).toString(),
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
    } catch (error: any) {
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
          <div className="mb-8">
            <PositionSection handleBorrow={handleBorrow} handleRepay={handleRepay} loanData={loans} userCollaterals={collateralInfo} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Eligible Collateral</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Wallet Balance</TableHead>
                    <TableHead>USD Value</TableHead>
                    <TableHead>LTV</TableHead>
                    <TableHead>Liquidation Threshold</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCollateral ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <LoadingSpinner />
                      </TableCell>
                    </TableRow>
                  ) : eligibleCollateral.length > 0 ? (
                    eligibleCollateral.map((asset) => (
                      <TableRow key={asset?.address}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                              style={{ backgroundColor: "red" }}
                            >
                              {asset?._symbol.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-medium">{asset?._name}</div>
                              <div className="text-xs text-gray-500">{asset?._symbol}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatUnits(asset?.userBalance,18)}</TableCell>
                        <TableCell>
                          ${formatTokenAmount(asset?.userBalanceValue)}
                        </TableCell>
                        <TableCell>
                          {asset?.ltv ? asset?.ltv/100 : 0}%
                        </TableCell>
                        <TableCell>{asset?.liquidationThreshold ? asset?.liquidationThreshold/100 : 0}%</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => handleSupply(asset)}
                            className="flex items-center gap-1"
                          >
                            Supply
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) :
                    <TableRow>
                      <TableCell colSpan={7}>
                        <div className="w-full flex justify-center items-center mt-4">
                          No data to show
                        </div>
                      </TableCell>
                    </TableRow>
                  }
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Supplied Collateral</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Supplied Balance</TableHead>
                    <TableHead>USD Value</TableHead>
                    <TableHead>LTV</TableHead>
                    <TableHead>Liquidation Threshold</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCollateral ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <LoadingSpinner />
                      </TableCell>
                    </TableRow>
                  ) : suppliedCollateral?.length > 0 ? (
                    suppliedCollateral?.map((loan, loanIndex) => (
                      <TableRow key={loanIndex}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                              style={{ backgroundColor: "red" }}
                            >
                              {loan?._symbol?.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-medium">{loan?._name || loan?._symbol}</div>
                              <div className="text-xs text-gray-500">{loan?._symbol}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatUnits(loan?.collateralizedAmount, 18)}</TableCell>
                        <TableCell>
                          ${formatTokenAmount(loan?.collateralizedAmountValue || 0)}
                        </TableCell>
                        <TableCell>
                          {loan?.ltv ? loan?.ltv/100 : 0}%
                        </TableCell>
                        <TableCell>
                          {loan?.liquidationThreshold ? loan?.liquidationThreshold/100 : 0}%
                        </TableCell>
                        <TableCell>
                          <Button
                            onClick={() => {handleWithdraw(loan)}}
                          >
                            Withdraw
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) :
                    <TableRow>
                      <TableCell colSpan={4}>
                        <div className="w-full flex justify-center items-center mt-4">
                          No data to show
                        </div>
                      </TableCell>
                    </TableRow>
                  }
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>

      
        <BorrowAssetModal
          borrowLoading={borrowLoading}
          isOpen={isBorrowModalOpen}
          onClose={closeBorrowModal}
          onBorrow={(amount) => executeBorrow(amount)}
          loan={loans}
          usdstBalance={usdstBalance}
        />

      <RepayModal
        isOpen={showRepayModal}
        onClose={closeRepayModal}
        loan={loans}
        onRepaySuccess={async () => {
          try {
            await Promise.all([
              refreshLoans(),
              refreshCollateral(),
              fetchUsdstBalance(userAddress || ""),
            ]);
          } catch (error) {
            console.error("Error refreshing data:", error);
          }
        }}
        usdstBalance={usdstBalance}
      />

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

export default BorrowNew;
