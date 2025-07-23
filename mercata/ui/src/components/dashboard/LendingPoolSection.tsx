import { formatUnits } from "ethers";
import { DollarSign, ArrowDown, ArrowUp } from "lucide-react";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { LENDING_DEPOSIT_FEE, LENDING_WITHDRAW_FEE } from "@/lib/constants";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";

const LendingPoolSection = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, loading, fetchTokens, fetchUsdstBalance } = useUserTokens();
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
    fetchUsdstBalance(userAddress);
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
      const amountWei = safeParseUnits(depositAmount, 18);
      const availableWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
      const feeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
      
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
      const amountWei = safeParseUnits(withdrawAmount, 18);
      const maxWithdrawableWei = BigInt(liquidityInfo?.withdrawable?.maxWithdrawableUSDST || "0");
      const feeWei = safeParseUnits(LENDING_WITHDRAW_FEE, 18);
      const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
      
      if (amountWei <= 0n) return false;
      if (amountWei > maxWithdrawableWei) return false; // Check against max withdrawable (considers both user balance and pool liquidity)
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
      const amountWei = safeParseUnits(amount, 18).toString();
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
      // Error toast is now handled globally by axios interceptor
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
                        className={`pl-16 ${!isDepositAmountValid() ? 'text-red-600' : ''}`}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">USDST</span>
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("deposit")}
                      className="bg-strato-blue hover:bg-strato-blue/90 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
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
                    <button
                      type="button"
                      onClick={() => {
                        const availableWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                        const feeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
                        const maxDepositableWei = availableWei > feeWei ? availableWei - feeWei : 0n;
                        const formatted = formatUnits(maxDepositableWei, 18);

                        // Clamp to 18 decimals
                        const [whole, frac = ""] = formatted.split(".");
                        const clamped = `${whole}.${frac.slice(0, 18)}`;
                        setDepositAmount(clamped);
                      }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      Max
                    </button>
                    Available:{" "}
                    {loadingLiquidity ?
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                      : liquidityInfo?.supplyable?.userBalance
                        ? formatBalance(liquidityInfo.supplyable.userBalance || 0n, undefined, 18, 2)
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
                    const feeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
                    const depositAmountWei = depositAmount ? safeParseUnits(depositAmount, 18) : 0n;
                    
                    // Check if user has enough USDST for fee
                    const isInsufficientUsdstForFee = !loadingLiquidity && availableWei < feeWei;
                    
                    // Check if deposit amount + fee exceeds available balance
                    const isInsufficientBalanceForDepositAndFee = !loadingLiquidity && depositAmountWei + feeWei > availableWei && depositAmountWei <= availableWei;
                    
                    // Check if remaining balance after deposit and fee is low
                    const lowBalanceThreshold = safeParseUnits("0.10", 18);
                    const remainingBalance = availableWei - depositAmountWei - feeWei;
                    const isLowBalanceWarning = depositAmountWei > 0n && remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                    
                    return (
                      <>
                        {isInsufficientBalanceForDepositAndFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Insufficient USDST balance for transaction fee ({LENDING_DEPOSIT_FEE} USDST)
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
                        className={`pl-16 ${!isWithdrawAmountValid() ? 'text-red-600' : ''}`}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">USDST</span>
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("withdraw")}
                      variant="outline"
                      className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
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
                    <button
                      type="button"
                      onClick={() => {
                        const rawMax = liquidityInfo?.withdrawable?.maxWithdrawableUSDST;
                        const exchangeRateWei = BigInt(liquidityInfo?.withdrawable?.exchangeRate || "1000000000000000000");
                        const userMTokenBalanceWei = BigInt(liquidityInfo?.withdrawable?.userBalance || "0");
                        const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                        const feeWei = safeParseUnits(LENDING_WITHDRAW_FEE, 18);

                        if (!rawMax || usdstBalanceWei < feeWei) return;

                        const maxWithdrawableViaMToken = (userMTokenBalanceWei * exchangeRateWei) / (10n ** 18n);
                        const rawMaxWei = BigInt(rawMax);
                        const safeMaxWei = rawMaxWei < maxWithdrawableViaMToken ? rawMaxWei : maxWithdrawableViaMToken;

                        if (safeMaxWei <= 0n) return;

                        const formatted = formatUnits(safeMaxWei, 18);
                        const [w, f = ""] = formatted.split(".");
                        const clamped = f.length > 18 ? `${w}.${f.slice(0, 18)}` : formatted;
                        const clampedClean = clamped.replace(/\.?0+$/, "");

                        setWithdrawAmount(clampedClean);
                      }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      Max
                    </button>
                    Withdrawable:{" "}
                    {loadingLiquidity ?
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                      : liquidityInfo?.withdrawable?.maxWithdrawableUSDST
                        ? formatBalance(liquidityInfo.withdrawable.maxWithdrawableUSDST || 0n, "USDST", 18, 2, 2)
                        : "0.00"}{" "}
                    ({liquidityInfo?.withdrawable?.userBalance ? formatBalance(liquidityInfo?.withdrawable?.userBalance || 0n,"mUSDST", 18) : "0.00"} )
                  </div>
                  {/* Fee Display */}
                  <div className="text-sm text-gray-500 mt-1">
                    Transaction Fee: {LENDING_WITHDRAW_FEE} USDST
                  </div>
                  {/* Fee Warning */}
                  {(() => {
                    const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                    const feeWei = safeParseUnits(LENDING_WITHDRAW_FEE, 18);
                    
                    // Check if user has enough USDST for fee
                    const isInsufficientUsdstForFee = !loadingLiquidity && usdstBalanceWei < feeWei;
                    
                    // Check if remaining balance after fee is low
                    const lowBalanceThreshold = safeParseUnits("0.10", 18);
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
                      formatBalance(liquidityInfo.totalUSDSTSupplied || 0n, undefined, 18, 2, 2, true)
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
                      formatBalance(liquidityInfo.totalBorrowed || 0n, undefined, 18, 2, 2, true)
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
                      formatBalance(liquidityInfo.availableLiquidity || 0n, undefined, 18, 2, 2, true)
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
                        formatBalance(liquidityInfo.totalCollateralValue || 0n, undefined, 18, 2, 2, true)
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
                  <span className="text-gray-500 text-sm sm:text-base">Max Supply APY</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.maxSupplyAPY ? `${liquidityInfo.maxSupplyAPY}%` : "N/A"}</span>
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
                      formatBalance(liquidityInfo.withdrawable.userBalance || 0n, undefined, 18, 2, 2)
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LendingPoolSection;
