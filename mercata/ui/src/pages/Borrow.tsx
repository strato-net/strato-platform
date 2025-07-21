import { useEffect, useState } from "react";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

import { CollateralData } from "@/interface";
import PositionSection from "@/components/Positions";
import SupplyCollateralModal from "@/components/SupplyCollateral";
import WithdrawCollateralModal from "@/components/WithdrawCollateral";

const LoadingSpinner = () => (
  <div className="flex justify-center items-center h-12">
    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
  </div>
);

// Reusable InfoTooltip component
const InfoTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="inline-flex items-center gap-1 cursor-help">
        {children}
        <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600" />
      </div>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">
      <p>{content}</p>
    </TooltipContent>
  </Tooltip>
);

const Borrow = () => {
  const { userAddress } = useUser();
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();
  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false)
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
      const filtered = collateralInfo.filter((item) => parseFloat(item.collateralizedAmount) > 0);
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
      await borrowAssetFn({ amount: safeParseUnits(amount, 18).toString() });
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
    } catch (error) {
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
              <CardTitle>
                <InfoTooltip content="Tokens in your wallet that you can supply as collateral. Supply these tokens to enable borrowing USDST.">
                  Eligible Collateral
                </InfoTooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Wallet Balance</TableHead>
                    <TableHead>USD Value</TableHead>
                    <TableHead>
                      <InfoTooltip content="Loan-to-Value ratio: Maximum percentage of collateral value you can borrow against. Higher LTV means more borrowing power but higher risk.">
                        LTV
                      </InfoTooltip>
                    </TableHead>
                    <TableHead>
                      <InfoTooltip content="If your position value falls below this percentage, your collateral may be liquidated to repay your debt. Keep your position above this threshold.">
                        Liquidation Threshold
                      </InfoTooltip>
                    </TableHead>
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
                            {asset?.images?.[0] ? (
                              <img
                                src={asset.images[0].value}
                                alt={asset._name}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                                style={{ backgroundColor: "red" }}
                              >
                                {asset?._symbol.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <div className="font-medium">{asset?._name}</div>
                              <div className="text-xs text-gray-500">{asset?._symbol}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatBalance(asset?.userBalance || 0n, undefined, 18, 2)}</TableCell>
                        <TableCell>
                          ${formatBalance(asset?.userBalanceValue, undefined, 18, 1, 2)}
                        </TableCell>
                        <TableCell>
                          {asset?.ltv ? asset?.ltv/100 : 0}%
                        </TableCell>
                        <TableCell>{asset?.liquidationThreshold ? asset?.liquidationThreshold/100 : 0}%</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                onClick={() => handleSupply(asset)}
                                className="flex items-center gap-1"
                              >
                                Supply
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Deposit tokens as collateral to enable borrowing. You can withdraw these tokens later.</p>
                            </TooltipContent>
                          </Tooltip>
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
              <CardTitle>
                <InfoTooltip content="Tokens you've supplied as collateral for your loans. These determine your borrowing power and can be withdrawn when you no longer need them.">
                  Supplied Collateral
                </InfoTooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>
                      <InfoTooltip content="Amount of tokens currently used as collateral for your loans. This determines your borrowing power.">
                        Supplied Balance
                      </InfoTooltip>
                    </TableHead>
                    <TableHead>USD Value</TableHead>
                    <TableHead>
                      <InfoTooltip content="Loan-to-Value ratio: Maximum percentage of collateral value you can borrow against. Higher LTV means more borrowing power but higher risk.">
                        LTV
                      </InfoTooltip>
                    </TableHead>
                    <TableHead>
                      <InfoTooltip content="If your position value falls below this percentage, your collateral may be liquidated to repay your debt. Keep your position above this threshold.">
                        Liquidation Threshold
                      </InfoTooltip>
                    </TableHead>
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
                            {loan?.images?.[0] ? (
                              <img
                                src={loan.images[0].value}
                                alt={loan._name || loan._symbol}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                                style={{ backgroundColor: "red" }}
                              >
                                {loan?._symbol?.slice(0, 2)}
                              </div>
                            )}
                            <div>
                              <div className="font-medium">{loan?._name || loan?._symbol}</div>
                              <div className="text-xs text-gray-500">{loan?._symbol}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatBalance(loan?.collateralizedAmount || 0n, undefined, 18, 2)}</TableCell>
                        <TableCell>
                          {formatBalance(loan?.collateralizedAmountValue, undefined, 18, 1, 2,true)}
                        </TableCell>
                        <TableCell>
                          {loan?.ltv ? loan?.ltv/100 : 0}%
                        </TableCell>
                        <TableCell>
                          {loan?.liquidationThreshold ? loan?.liquidationThreshold/100 : 0}%
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                onClick={() => {handleWithdraw(loan)}}
                              >
                                Withdraw
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Remove collateral from your position. This reduces your borrowing power and may affect your loan if you have outstanding debt.</p>
                            </TooltipContent>
                          </Tooltip>
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

export default Borrow;
