import { formatUnits, parseUnits } from "ethers";
import { DollarSign, ArrowDown, ArrowUp } from "lucide-react";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { LENDING_DEPOSIT_FEE, LENDING_WITHDRAW_FEE } from "@/lib/contants";

const LendingPoolSection = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, loading, fetchTokens } = useUserTokens();
  const {
    liquidityInfo,
    loadingLiquidity,
    refreshLiquidity,
    depositLiquidity,
    withdrawLiquidity,
  } = useLendingContext();
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const refreshLendingData = (signal?: AbortSignal) => {
    if (!userAddress) return;
    fetchTokens(signal);
    refreshLiquidity(signal);
  };

  // 1. Fetch on userAddress change only, with abort controller
  useEffect(() => {
    if (!userAddress) return;
    const abortController = new AbortController();
    refreshLendingData(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, [userAddress]);


  const isDepositAmountValid = () => {
    if (!depositAmount) return false;
    if (!/^\d+(\.\d{1,18})?$/.test(depositAmount)) return false;
    try {
      const amountWei = parseUnits(depositAmount, 18);
      const availableWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
      const feeWei = parseUnits(LENDING_DEPOSIT_FEE, 18);
      
      if (amountWei <= 0n) return false;
      if (amountWei > availableWei) return false;
      if (amountWei + feeWei > availableWei) return false;
      return true;
    } catch {
      return false;
    }
  };

  const isWithdrawAmountValid = () => {
    if (!withdrawAmount) return false;
    if (!/^\d+(\.\d{1,18})?$/.test(withdrawAmount)) return false;
    try {
      const amountWei = parseUnits(withdrawAmount, 18);
      const userMTokenBalanceWei = BigInt(liquidityInfo?.withdrawable?.userBalance || "0");
      const exchangeRateWei = BigInt(liquidityInfo?.withdrawable?.exchangeRate || "1000000000000000000"); // Default 1:1 if not available
      const feeWei = parseUnits(LENDING_WITHDRAW_FEE, 18);
      const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
      
      // Calculate how many mUSDST would be burned for this withdrawal
      const mTokensToBurn = (amountWei * (10n ** 18n)) / exchangeRateWei;
      if (amountWei <= 0n) return false;
      if (mTokensToBurn > userMTokenBalanceWei) return false; // Check if user has enough mUSDST
      if (usdstBalanceWei < feeWei) return false;
      return true;
    } catch {
      return false;
    }
  };

  const handleLiquidityAction = async (type: "deposit" | "withdraw") => {
    try {
      setIsProcessing(true);
      const amount = type === "deposit" ? depositAmount : withdrawAmount;
      const amountWei = parseUnits(amount, 18).toString();
      await (type === "deposit" ? depositLiquidity : withdrawLiquidity)({
        amount: amountWei,
      });

      toast({
        title:
          type === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description: `You have successfully ${type}ed ${amount} USDST.`,
        variant: "success",
      });

      if (type === "deposit") {
        setDepositAmount("");
      } else {
        setWithdrawAmount("");
      }

      refreshLendingData();
    } catch (error) {
      toast({
        title: type === "deposit" ? "Deposit Error" : "Withdrawal Error",
        description: `Something went wrong - ${error?.message || "Please try again later."}`,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <Card className="mb-6 border-0 md:border shadow-none md:shadow-sm">
        <CardHeader className="px-2 py-2 md:px-6 md:py-6">
          <div className="flex justify-between items-center">
            <CardTitle>USDST Lending Pool</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-2 py-2 md:px-6 md:py-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-4 border">
              <div className="flex justify-between mb-4">
                <h3 className="font-medium">Pool Stats</h3>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total USDST Supplied</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : liquidityInfo ? (
                      `$${Number(
                        formatUnits(liquidityInfo.totalUSDSTSupplied || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total USDST Borrowed</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : liquidityInfo?.totalBorrowed ? (
                      `$${Number(
                        formatUnits(liquidityInfo.totalBorrowed || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Utilization Rate</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.utilizationRate || '0'}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Available Liquidity</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                     {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : liquidityInfo?.availableLiquidity ? (
                      `$${Number(
                        formatUnits(liquidityInfo?.availableLiquidity || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total Collateral Value</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : liquidityInfo?.totalCollateralValue ? (
                      `$${Number(
                        formatUnits(liquidityInfo?.totalCollateralValue || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Supply APY</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.supplyAPY ? `${liquidityInfo.supplyAPY}%` : "N/A"}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Borrow APY</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.borrowAPY ? `${liquidityInfo.borrowAPY}%` : "N/A"}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Your mUSDST</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : liquidityInfo?.withdrawable?.userBalance ? (
                      `${Number(
                        formatUnits(liquidityInfo?.withdrawable?.userBalance || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Conversion Rate</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">{liquidityInfo?.exchangeRate ? "1 mUSDST = " + formatUnits(liquidityInfo?.exchangeRate || 0, 18) + " USDST" : "N/A"}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex flex-col space-y-4">
                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Deposit</h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className={`pl-8 ${!isDepositAmountValid() ? 'text-red-600' : ''}`}
                      />
                      <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("deposit")}
                      className="bg-strato-blue hover:bg-strato-blue/90 w-full sm:w-auto hidden sm:flex sm:items-center sm:justify-center"
                      disabled={loading || isProcessing || !isDepositAmountValid()}
                    >
                      {isProcessing ? (
                        "Processing..."
                      ) : (
                        <>
                          <ArrowDown className="mr-2 h-4 w-4" />
                          Deposit
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    Available:{" "}
                    {loadingLiquidity ?
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                      : liquidityInfo?.supplyable?.userBalance
                        ? Number(
                          formatUnits(liquidityInfo?.supplyable?.userBalance || 0, 18)
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 4,
                        })
                        : "0.00"}{" "}
                    USDST
                  </div>
                  {/* Fee Display */}
                  <div className="text-sm text-gray-500 mt-1">
                    Transaction Fee: {LENDING_DEPOSIT_FEE} USDST
                  </div>
                  {/* Fee Warning */}
                  {(() => {
                    const availableWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                    const feeWei = parseUnits(LENDING_DEPOSIT_FEE, 18);
                    const depositAmountWei = depositAmount ? parseUnits(depositAmount, 18) : 0n;
                    
                    // Check if user has enough USDST for fee
                    const isInsufficientUsdstForFee = availableWei < feeWei;
                    
                    // Check if deposit amount + fee exceeds available balance
                    const isInsufficientBalanceForDepositAndFee = depositAmountWei + feeWei > availableWei && depositAmountWei <= availableWei;
                    
                    // Check if remaining balance after deposit and fee is low
                    const lowBalanceThreshold = parseUnits("0.10", 18);
                    const remainingBalance = availableWei - depositAmountWei - feeWei;
                    const isLowBalanceWarning = depositAmountWei > 0n && remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                    
                    return (
                      <>
                        {isInsufficientUsdstForFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Insufficient USDST balance for transaction fee ({LENDING_DEPOSIT_FEE} USDST)
                          </p>
                        )}
                        {isInsufficientBalanceForDepositAndFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Insufficient balance for transaction fee ({LENDING_DEPOSIT_FEE} USDST)
                          </p>
                        )}
                        {isLowBalanceWarning && !isInsufficientUsdstForFee && !isInsufficientBalanceForDepositAndFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {/* Mobile Button */}
                  <Button
                    onClick={() => handleLiquidityAction("deposit")}
                    className="bg-strato-blue hover:bg-strato-blue/90 w-full mt-4 sm:hidden"
                    disabled={loading || isProcessing || !isDepositAmountValid()}
                  >
                    {isProcessing ? (
                      "Processing..."
                    ) : (
                      <>
                        <ArrowDown className="mr-2 h-4 w-4" />
                        Deposit
                      </>
                    )}
                  </Button>
                </div>

                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Withdraw</h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        className={`pl-8 ${!isWithdrawAmountValid() ? 'text-red-600' : ''}`}
                      />
                      <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("withdraw")}
                      variant="outline"
                      className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full sm:w-auto hidden sm:flex sm:items-center sm:justify-center"
                      disabled={
                        loadingLiquidity ||
                        isProcessing ||
                        !isWithdrawAmountValid()
                      }
                    >
                      {isProcessing ? (
                        "Processing..."
                      ) : (
                        <>
                          <ArrowUp className="mr-2 h-4 w-4" />
                          Withdraw
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    Max Withdrawable:{" "}
                    {loadingLiquidity ?
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                      : liquidityInfo?.withdrawable?.maxWithdrawableUSDST
                        ? formatUnits(liquidityInfo?.withdrawable?.maxWithdrawableUSDST || 0, 18)
                        : "0.00"}{" "}
                    USDST ({liquidityInfo?.withdrawable?.userBalance ? formatUnits(liquidityInfo?.withdrawable?.userBalance || 0, 18) : "0.00"} mUSDST)
                  </div>
                  {/* Fee Display */}
                  <div className="text-sm text-gray-500 mt-1">
                    Transaction Fee: {LENDING_WITHDRAW_FEE} USDST
                  </div>
                  {/* Fee Warning */}
                  {(() => {
                    const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                    const feeWei = parseUnits(LENDING_WITHDRAW_FEE, 18);
                    
                    // Check if user has enough USDST for fee
                    const isInsufficientUsdstForFee = usdstBalanceWei < feeWei;
                    
                    // Check if remaining balance after fee is low
                    const lowBalanceThreshold = parseUnits("0.10", 18);
                    const remainingBalance = usdstBalanceWei - feeWei;
                    const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                    
                    return (
                      <>
                        {isInsufficientUsdstForFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Insufficient USDST balance for transaction fee ({LENDING_WITHDRAW_FEE} USDST)
                          </p>
                        )}
                        {isLowBalanceWarning && !isInsufficientUsdstForFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {/* Mobile Button */}
                  <Button
                    onClick={() => handleLiquidityAction("withdraw")}
                    variant="outline"
                    className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full mt-4 sm:hidden"
                    disabled={
                      loadingLiquidity ||
                      isProcessing ||
                      !isWithdrawAmountValid()
                    }
                  >
                    {isProcessing ? (
                      "Processing..."
                    ) : (
                      <>
                        <ArrowUp className="mr-2 h-4 w-4" />
                        Withdraw
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LendingPoolSection;
