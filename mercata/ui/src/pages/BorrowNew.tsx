import { useEffect, useState } from "react";
import { formatEther, formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
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
    if (collateralInfo && Array.isArray(collateralInfo)) {
      const filtered = collateralInfo.filter((item) => item.collateralizedAmount > 0);
      setSuppliedCollateral(filtered);
      setEligibleCollateral(collateralInfo)
    }
  }, [collateralInfo])


  useEffect(() => {
    refreshLoans();
  }, []);

  const handleBorrow = () => {
    setIsBorrowModalOpen(true);
  };
  
  const closeBorrowModal = () => {
    setIsBorrowModalOpen(false);
  };

  const executeBorrow = async (amount: number) => {
    try {
      setBorrowLoading(true);
      const amountInWei = parseUnits(amount.toString(), 18).toString();

      await borrowAssetFn({
        amount: amountInWei,
      });

      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${amount} USDT.`,
        variant: "success",
      });

      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      await refreshLoans();
    } catch (error: any) {
      console.log(error, "error");
      setBorrowLoading(false);
      setIsBorrowModalOpen(false);
      toast({
        title: "Borrow Error",
        description: `Something went wrong - ${error?.message || "Please try again later."
          }`,
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

  const executeSupply = async (asset: DepositableToken, amount: number) => {
    try {
      setSupplyLoading(true);
      const amountInWei = parseUnits(amount.toString(), 18).toString();

      await supplyCollateral({
        amount: amountInWei,
        asset: asset?.address,
      });

      toast({
        title: "Supply Initiated",
        description: `You supplied ${amount}`,
        variant: "success",
      });

      setSupplyLoading(false);
      setIsSupplyModalOpen(false);
      await refreshLoans()
      await refreshCollateral();
    } catch (error: any) {
      console.log(error, "error");
      setSupplyLoading(false);
      setIsSupplyModalOpen(false);
      toast({
        title: "Supply Error",
        description: `Something went wrong - ${error?.message || "Please try again later."
          }`,
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

  const executeWithdraw = async (asset: DepositableToken, amount: number) => {
    try {
      setWithdrawLoading(true);
      const amountInWei = parseUnits(amount.toString(), 18).toString();

      await withdrawCollateral({
        amount: amountInWei,
        asset: asset?.address,
      });

      toast({
        title: "Withdraw Initiated",
        description: `You withdraw ${amount}`,
        variant: "success",
      });

      setWithdrawLoading(false);
      setIsWithdrawModalOpen(false);
      await refreshLoans()
      await refreshCollateral();
    } catch (error: any) {
      console.log(error, "error");
      setWithdrawLoading(false);
      setIsWithdrawModalOpen(false);
      toast({
        title: "Withdraw Error",
        description: `Something went wrong - ${error?.message || "Please try again later."
          }`,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title="Borrow" />

        <main className="p-6">
          <div className="mb-8">
            <PositionSection handleBorrow={handleBorrow} handleRepay={handleRepay} loanData={loans} userCollaterals={eligibleCollateral} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Elligible Collateral</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Wallet Balance</TableHead>
                    <TableHead>USD Value</TableHead>
                    <TableHead>Borrowing Power if Supplied</TableHead>
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
                          {formatTokenAmount(asset?.maxBorrowingPower)}
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
                    <TableHead>Available to Withdraw</TableHead>
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
                        <TableCell>{formatEther(loan?.availableToWithdraw || 0)}</TableCell>
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
        />

      <RepayModal
        isOpen={showRepayModal}
        onClose={closeRepayModal}
        loan={loans}
        onRepaySuccess={async () => {
          await refreshLoans();
        }}
      />

      <SupplyCollateralModal 
          supplyLoading={supplyLoading}
          asset={selectedAsset}
          isOpen={isSupplyModalOpen}
          onClose={closeSupplyModal}
          onSupply={(amount) => executeSupply(selectedAsset, amount)}
      />

       <WithdrawCollateralModal 
          withdrawLoading={withdrawLoading}
          asset={selectedAsset}
          isOpen={isWithdrawModalOpen}
          onClose={closeWithdrawModal}
          onWithdraw={(amount) => executeWithdraw(selectedAsset, amount)}
      />

    </div>
  );
};

export default BorrowNew;
