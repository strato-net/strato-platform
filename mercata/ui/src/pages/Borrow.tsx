import { useEffect, useState } from "react";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { BORROW_FEE, REPAY_FEE } from "@/lib/constants";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { addCommasToInput, formatCurrency } from "@/utils/numberUtils";

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
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [supplyLoading, setSupplyLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // Embedded form states
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowDisplayAmount, setBorrowDisplayAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState<string>("");
  const [repayDisplayAmount, setRepayDisplayAmount] = useState("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [repayLoading, setRepayLoading] = useState(false);


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

  // Calculate risk level for borrow form
  useEffect(() => {
    try {
      const existingBorrowedBigInt = BigInt(loans?.totalAmountOwed || 0);
      const newBorrowAmountBigInt = safeParseUnits(borrowAmount || "0", 18);
      const totalBorrowedBigInt = existingBorrowedBigInt + newBorrowAmountBigInt;
      const collateralValueBigInt = BigInt(loans?.totalCollateralValueUSD || 0);

      if (collateralValueBigInt === 0n) {
        setRiskLevel(0);
        return;
      }

      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100));
    } catch {
      setRiskLevel(0);
    }
  }, [borrowAmount, loans?.totalCollateralValueUSD, loans?.totalAmountOwed]);

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

  // Helper functions for embedded forms
  const getRiskColor = () => {
    if (riskLevel < 30) return "bg-green-500";
    if (riskLevel < 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getRiskText = () => {
    if (riskLevel < 30) return "Low";
    if (riskLevel < 70) return "Moderate";
    return "High";
  };

  const handleBorrowAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setBorrowDisplayAmount(addCommasToInput(value));
      setBorrowAmount(value);
    }
  };

  const handleRepayAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, '');
    if (/^\d*\.?\d*$/.test(value)) {
      setRepayDisplayAmount(addCommasToInput(value));
      setRepayAmount(value);
    }
  };

  const handleBorrowPercentage = (percentageAmount: string) => {
    setBorrowAmount(percentageAmount);
    setBorrowDisplayAmount(addCommasToInput(percentageAmount));
  };

  const handleRepayPercentage = (percent: bigint) => {
    const totalOwed = BigInt(loans?.totalAmountOwed || 0);
    const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
    const maxAmount = available > 0n && available < totalOwed ? available : totalOwed;
    const amount = formatUnits((maxAmount * percent) / 100n, 18);
    setRepayAmount(amount);
    setRepayDisplayAmount(addCommasToInput(amount));
  };

  const executeEmbeddedBorrow = async () => {
    try {
      setBorrowLoading(true);
      await borrowAssetFn({ amount: safeParseUnits(borrowAmount, 18).toString() });
      toast({
        title: "Borrow Initiated",
        description: `You borrowed ${borrowAmount} USDST`,
        variant: "success",
      });
      setBorrowLoading(false);
      setBorrowAmount("");
      setBorrowDisplayAmount("");
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

  const executeEmbeddedRepay = async () => {
    try {
      setRepayLoading(true);
      const totalOwedWei = BigInt(loans?.totalAmountOwed || 0);
      let amountInWei = safeParseUnits(repayAmount || "0", 18);
      
      if (amountInWei > totalOwedWei) {
        amountInWei = totalOwedWei;
      }

      await repayLoanFn({
        amount: amountInWei.toString(),
      });
      
      toast({
        title: "Success",
        description: `Successfully Repaid ${repayAmount} USDST`,
        variant: "success",
      });
      
      setRepayAmount("");
      setRepayDisplayAmount("");
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
                    <div className="space-y-4 pt-4">
                      {/* Loan Details */}
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Available to borrow</span>
                          <span className="font-medium">
                            USDST {formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Currently borrowed</span>
                          <span className="font-medium">
                            USDST {loans?.totalAmountOwed ? formatUnits(loans.totalAmountOwed, 18) : "0.00"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Interest Rate</span>
                          <span className="font-medium">
                            {loans?.interestRate ? `${loans.interestRate.toFixed(2)}%` : "-"}
                          </span>
                        </div>
                      </div>

                      {/* Borrow Amount Input */}
                      <div className="space-y-3">
                        <label className="text-sm font-medium">Borrow Amount (USDST)</label>
                        <div className="flex justify-between items-center text-xs text-gray-500">
                          <span>Min: 0.01 USDST</span>
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                const availableToBorrowFormatted = formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18);
                                setBorrowAmount(availableToBorrowFormatted);
                                setBorrowDisplayAmount(addCommasToInput(availableToBorrowFormatted));
                              }}
                              className="px-2 py-1 mr-1 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-xs font-medium transition"
                            >
                              Max :
                            </button>
                            <span>{formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)} USDST</span>
                          </div>
                        </div>
                        <div className="relative">
                          <Input
                            placeholder="0.00"
                            className={`pr-16 ${safeParseUnits(borrowAmount || "0", 18) > BigInt(loans?.maxAvailableToBorrowUSD || 0) ? 'text-red-600' : ''}`}
                            value={borrowDisplayAmount}
                            onChange={handleBorrowAmountChange}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">USDST</span>
                        </div>
                        <PercentageButtons
                          value={borrowAmount}
                          maxValue={formatUnits(loans?.maxAvailableToBorrowUSD || 0, 18)}
                          onChange={handleBorrowPercentage}
                        />
                      </div>

                      {/* Risk Level */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span>Risk Level:</span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${riskLevel < 30
                                  ? "bg-green-50 text-green-700"
                                  : riskLevel < 70
                                    ? "bg-yellow-50 text-yellow-700"
                                    : "bg-red-50 text-red-700"
                                }`}
                            >
                              {getRiskText()}
                            </span>
                          </div>
                        </div>

                        <div className="relative">
                          <Progress value={riskLevel} className="h-2">
                            <div
                              className={`absolute inset-0 ${getRiskColor()} h-full rounded-full`}
                              style={{ width: `${riskLevel}%` }}
                            />
                          </Progress>

                          <div className="flex justify-between mt-1 text-xs text-gray-500">
                            <span>Safe</span>
                            <span>Risk Increases →</span>
                            <span>Liquidation</span>
                          </div>
                        </div>
                      </div>

                      {/* Transaction Fee */}
                      <div className="px-4 py-3 bg-gray-50 rounded-md">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-gray-600">Transaction Fee</span>
                          <span className="font-medium">{BORROW_FEE} USDST</span>
                        </div>
                        {(() => {
                          const feeAmount = safeParseUnits(BORROW_FEE, 18);
                          const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                          const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;

                          return isInsufficientUsdstForFee ? (
                            <p className="text-yellow-600 text-sm mt-1">
                              Insufficient USDST balance for transaction fee ({BORROW_FEE} USDST)
                            </p>
                          ) : null;
                        })()}
                      </div>

                      {/* Borrow Button */}
                      <Button
                        onClick={executeEmbeddedBorrow}
                        disabled={
                          !borrowAmount ||
                          borrowLoading ||
                          safeParseUnits(borrowAmount || "0", 18) > BigInt(loans?.maxAvailableToBorrowUSD || 0) ||
                          (() => {
                            const feeAmount = safeParseUnits(BORROW_FEE, 18);
                            const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                            return usdstBalanceBigInt < feeAmount;
                          })()
                        }
                        className="w-full"
                      >
                        {borrowLoading ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
                        ) : null}
                        Borrow
                      </Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="repay">
                    <div className="space-y-4 pt-4">
                      {loans ? (
                        <>
                          {/* Loan Details */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-500">Principal Balance</span>
                              <span className="font-medium">${formatUnits(loans?.principalBalance || 0, 18)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-500">Accrued Interest</span>
                              <span className="font-medium">${formatUnits(loans?.accruedInterest || 0, 18)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center font-bold pt-2 border-t">
                              <span>Total Amount Due</span>
                              <span className="text-lg">${formatUnits(loans?.totalAmountOwed || 0, 18)}</span>
                            </div>
                          </div>

                          {/* Repay Amount Input */}
                          <div className="space-y-3">
                            <label className="text-sm font-medium">Repay Amount (USDST)</label>
                            <div className="flex justify-between items-center text-xs text-gray-500">
                              <span>Min: 0.01 USDST</span>
                              <span>Max: {(() => {
                                const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                                const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
                                const max = available < totalOwed ? available : totalOwed;
                                return formatCurrency(formatUnits(max > 0n ? max : 0n, 18)) + " USDST";
                              })()}</span>
                            </div>
                            <div className="relative">
                              <Input
                                placeholder="0.00"
                                className={`pr-16 ${(() => { 
                                  const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                                  const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                                  const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
                                  return repayAmountWei > totalOwed || repayAmountWei > available ? 'text-red-600' : ''; 
                                })()}`}
                                value={repayDisplayAmount}
                                onChange={handleRepayAmountChange}
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">USDST</span>
                            </div>
                            
                            {/* USDST Balance Display */}
                            <div className="text-xs text-gray-500">
                              Your USDST Balance: {formatCurrency(formatUnits(usdstBalance || "0", 18))} USDST ({formatCurrency(formatUnits(BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18) > 0n ? BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18) : 0n, 18))} USDST available for repayment)
                            </div>
                            
                            {/* Balance validation warnings */}
                            {(() => {
                              const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                              const totalNeeded = repayAmountWei + safeParseUnits(REPAY_FEE, 18);
                              const balance = BigInt(usdstBalance || "0");
                              
                              return repayAmount && totalNeeded > balance ? (
                                <p className="text-red-600 text-sm mt-1">
                                  Insufficient USDST balance. You need {formatCurrency(formatUnits(totalNeeded, 18))} USDST ({formatCurrency(formatUnits(repayAmountWei, 18))} + {REPAY_FEE} fee) but have {formatCurrency(formatUnits(balance, 18))} USDST.
                                </p>
                              ) : null;
                            })()}
                            
                            {/* Max amount validation warnings */}
                            {(() => {
                              const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                              const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                              const available = BigInt(usdstBalance || "0") - safeParseUnits(REPAY_FEE, 18);
                              const maxAmount = available < totalOwed ? available : totalOwed;
                              
                              return repayAmount && repayAmountWei > maxAmount ? (
                                <p className="text-red-600 text-sm mt-1">
                                  Amount cannot exceed {formatCurrency(formatUnits(maxAmount, 18))} USDST.
                                </p>
                              ) : null;
                            })()}
                            
                            {/* Percentage Buttons */}
                            <div className="flex gap-1">
                              <Button
                                variant={safeParseUnits(repayAmount || "0", 18) === (BigInt(loans?.totalAmountOwed || 0) * 10n) / 100n ? "default" : "outline"}
                                size="sm"
                                onClick={() => handleRepayPercentage(10n)}
                                className="flex-1 text-xs px-2"
                              >
                                10%
                              </Button>
                              <Button
                                variant={safeParseUnits(repayAmount || "0", 18) === (BigInt(loans?.totalAmountOwed || 0) * 25n) / 100n ? "default" : "outline"}
                                size="sm"
                                onClick={() => handleRepayPercentage(25n)}
                                className="flex-1 text-xs px-2"
                              >
                                25%
                              </Button>
                              <Button
                                variant={safeParseUnits(repayAmount || "0", 18) === (BigInt(loans?.totalAmountOwed || 0) * 50n) / 100n ? "default" : "outline"}
                                size="sm"
                                onClick={() => handleRepayPercentage(50n)}              
                                className="flex-1 text-xs px-2"
                              >
                                50%
                              </Button>
                              <Button
                                variant={safeParseUnits(repayAmount || "0", 18) === BigInt(loans?.totalAmountOwed || 0) ? "default" : "outline"}
                                size="sm"
                                onClick={() => handleRepayPercentage(100n)}
                                className="flex-1 text-xs px-2"
                              >
                                100%
                              </Button>
                            </div>
                          </div>

                          {/* Payment Summary */}
                          <div className="space-y-2 pt-3 border-t">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-500">Payment Amount</span>
                              <span className="font-medium">
                                {repayAmount ? `${formatCurrency(repayAmount)} USDST` : "0.00 USDST"}
                              </span>
                            </div>
                            
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-500">Remaining Balance</span>
                              <span className="font-medium">
                                {(() => {
                                  try {
                                    const totalOwed = BigInt(loans?.totalAmountOwed || 0);
                                    const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                                    const remaining = totalOwed - repayAmountWei;
                                    return `${formatCurrency(formatUnits(remaining > 0n ? remaining : 0n, 18))} USDST`;
                                  } catch {
                                    return `${formatCurrency(formatUnits(loans?.totalAmountOwed || 0, 18))} USDST`;
                                  }
                                })()}
                              </span>
                            </div>
                          </div>

                          {/* Transaction Fee */}
                          <div className="px-4 py-3 bg-gray-50 rounded-md">
                            <div className="flex justify-between text-sm mb-2">
                              <span className="text-gray-600">Transaction Fee</span>
                              <span className="font-medium">{REPAY_FEE} USDST</span>
                            </div>
                            {(() => {
                              const feeAmount = safeParseUnits(REPAY_FEE, 18);
                              const usdstBalanceBigInt = BigInt(usdstBalance || "0");
                              const isInsufficientUsdstForFee = usdstBalanceBigInt < feeAmount;
                              
                              return isInsufficientUsdstForFee ? (
                                <p className="text-yellow-600 text-sm mt-1">
                                  Insufficient USDST balance for transaction fee ({REPAY_FEE} USDST)
                                </p>
                              ) : null;
                            })()}
                          </div>

                          {/* Repay Button */}
                          <Button
                            onClick={executeEmbeddedRepay}
                            disabled={
                              repayLoading ||
                              !repayAmount ||
                              (() => { try { return safeParseUnits(repayAmount || "0", 18) === 0n; } catch { return true; } })() ||
                              (() => { try { return safeParseUnits(repayAmount || "0", 18) > BigInt(loans?.totalAmountOwed || 0); } catch { return true; } })() ||
                              (() => {
                                const repayAmountWei = safeParseUnits(repayAmount || "0", 18);
                                const totalNeeded = repayAmountWei + safeParseUnits(REPAY_FEE, 18);
                                return BigInt(usdstBalance || "0") < totalNeeded;
                              })()
                            }
                            className="w-full"
                          >
                            {repayLoading ? (
                              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
                            ) : (
                              `Repay ${repayAmount ? `${formatCurrency(repayAmount)} USDST` : "0.00 USDST"}`
                            )}
                          </Button>
                        </>
                      ) : (
                        <div className="text-center text-gray-500 py-8">
                          No active loan to repay
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Right Column - Your Position */}
            <div>
              <PositionSection loanData={loans} userCollaterals={collateralInfo} />
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                <InfoTooltip content="Manage your collateral assets. Supply tokens from your wallet or withdraw supplied collateral.">
                  Collateral Management
                </InfoTooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>
                      <InfoTooltip content="Loan-to-Value ratio: Maximum percentage of collateral value you can borrow against. Higher LTV means more borrowing power but higher risk.">
                        LTV
                      </InfoTooltip>
                    </TableHead>
                    <TableHead>
                      <InfoTooltip content="Liquidation Threshold: If your position value falls below this percentage, your collateral may be liquidated to repay your debt. Keep your position above this threshold.">
                        LT
                      </InfoTooltip>
                    </TableHead>
                    <TableHead className="text-right">Supply</TableHead>
                    <TableHead className="text-right">Withdraw</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCollateral ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <LoadingSpinner />
                      </TableCell>
                    </TableRow>
                  ) : collateralInfo && collateralInfo.length > 0 ? (
                    collateralInfo.map((asset) => {
                      const hasWalletBalance = BigInt(asset?.userBalance || 0) > 0n;
                      const hasSuppliedBalance = parseFloat(asset?.collateralizedAmount || "0") > 0;
                      
                      // Only show assets that have either wallet balance or supplied balance
                      if (!hasWalletBalance && !hasSuppliedBalance) return null;
                      
                      return (
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
                          <TableCell>
                            {asset?.ltv ? (asset.ltv / 100) : 0}%
                          </TableCell>
                          <TableCell>
                            {asset?.liquidationThreshold ? (asset.liquidationThreshold / 100) : 0}%
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-4">
                              <div className="text-right">
                                <div className="font-medium">{formatBalance(asset?.userBalance || 0n, undefined, 18, 2)}</div>
                                <div className="text-xs text-gray-500">
                                  ${formatBalance(asset?.userBalanceValue, undefined, 18, 1, 2)}
                                </div>
                              </div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    onClick={() => handleSupply(asset)}
                                    disabled={!hasWalletBalance}
                                  >
                                    <ArrowDownCircle className="h-4 w-4 mr-1" />
                                    Supply
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{hasWalletBalance ? "Deposit tokens as collateral to enable borrowing. You can withdraw these tokens later." : "No tokens in wallet to supply"}</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-4">
                              <div className="text-right">
                                <div className="font-medium">{formatBalance(asset?.collateralizedAmount || 0n, undefined, 18, 2)}</div>
                                <div className="text-xs text-gray-500">
                                  {formatBalance(asset?.collateralizedAmountValue, undefined, 18, 1, 2, true)}
                                </div>
                              </div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    onClick={() => handleWithdraw(asset)}
                                    disabled={!hasSuppliedBalance}
                                  >
                                    <ArrowUpCircle className="h-4 w-4 mr-1" />
                                    Withdraw
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{hasSuppliedBalance ? "Remove collateral from your position. This reduces your borrowing power and may affect your loan if you have outstanding debt." : "No collateral to withdraw"}</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <div className="w-full flex justify-center items-center mt-4">
                          No collateral assets available
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
