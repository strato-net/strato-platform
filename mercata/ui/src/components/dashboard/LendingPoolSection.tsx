import { formatUnits } from "ethers";
import { CircleArrowDown, CircleArrowUp } from "lucide-react";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { LENDING_DEPOSIT_FEE, LENDING_WITHDRAW_FEE, usdstAddress, musdstAddress } from "@/lib/constants";
import { formatBalance, safeParseUnits, addCommasToInput } from "@/utils/numberUtils";
import { useAmountValidation } from "@/utils/validationUtils";

const LendingPoolSection = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, loading, fetchTokens, fetchUsdstBalance } = useUserTokens();
  const {
    liquidityInfo,
    loadingLiquidity,
    refreshLiquidity,
    depositLiquidity,
    withdrawLiquidity,
    withdrawLiquidityAll,
  } = useLendingContext();
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositAmountError, setDepositAmountError] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [withdrawAmountError, setWithdrawAmountError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { handleInput, getMaxTransferable } = useAmountValidation();

  // AbortController ref for managing fetch cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Computed values
  const usdstToken = tokens.find(t => t.address === usdstAddress);
  const musdstToken = inactiveTokens.find(t => t.address === musdstAddress);
  const depositMaxAmount = usdstToken ? BigInt(usdstToken.balance || "0") : 0n;
  const withdrawMaxAmount = musdstToken ? BigInt(musdstToken.balance || "0") : 0n;
  
  const maxDepositTransferable = useMemo(() => {
    return getMaxTransferable(depositMaxAmount, usdstAddress, LENDING_DEPOSIT_FEE);
  }, [depositMaxAmount, getMaxTransferable]);
  
  const maxWithdrawTransferable = useMemo(() => {
    return getMaxTransferable(withdrawMaxAmount, musdstAddress, LENDING_WITHDRAW_FEE);
  }, [withdrawMaxAmount, getMaxTransferable]);

  // Centralized fee and voucher math - using integer math in cents
  const feeMath = useMemo(() => {
    const depositFeeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
    const withdrawFeeWei = safeParseUnits(LENDING_WITHDRAW_FEE, 18);
    
    // Integer math in cents (1 voucher = 1 cent = 0.01 USDST)
    // Convert fee strings to cents: "0.02" -> 2 cents, "0.01" -> 1 cent
    const depositFeeCents = parseInt(LENDING_DEPOSIT_FEE.replace('.', '').padEnd(3, '0'));
    const withdrawFeeCents = parseInt(LENDING_WITHDRAW_FEE.replace('.', '').padEnd(3, '0'));
    
    // 1 voucher = 1 cent, so vouchers required = fee in cents
    const depositVouchersRequired = depositFeeCents;
    const withdrawVouchersRequired = withdrawFeeCents;
    
    return {
      depositFeeWei,
      withdrawFeeWei,
      depositVouchersRequired,
      withdrawVouchersRequired,
      depositFeeDisplay: `${LENDING_DEPOSIT_FEE} USDST (${depositVouchersRequired} vouchers required)`,
      withdrawFeeDisplay: `${LENDING_WITHDRAW_FEE} USDST (${withdrawVouchersRequired} vouchers required)`,
    };
  }, []);

  // Precomputed max displays (don't duplicate in conditional)
  const maxDisplays = useMemo(() => ({
    depositMaxDisplay: formatBalance(maxDepositTransferable, "USDST", 18, 2, 4),
    withdrawMaxDisplay: formatBalance(maxWithdrawTransferable, "mUSDST", 18, 2, 4),
  }), [maxDepositTransferable, maxWithdrawTransferable]);

  // Precomputed display strings
  const displayStrings = useMemo(() => {
    const borrowIndexFormatted = liquidityInfo?.borrowIndex ? (() => {
      const s = formatUnits(liquidityInfo.borrowIndex, 27);
      const [w, f = ""] = s.split(".");
      return f ? `${w}.${f.slice(0, 5)}` : w;
    })() : "0";

    return {
      totalUSDSTSupplied: liquidityInfo?.totalUSDSTSupplied 
        ? formatBalance(liquidityInfo.totalUSDSTSupplied, "USDST", 18, 2, 2)
        : "0.00 USDST",
      totalBorrowed: liquidityInfo?.totalBorrowed 
        ? formatBalance(liquidityInfo.totalBorrowed, "USDST", 18, 2, 2)
        : "0.00 USDST",
      availableLiquidity: liquidityInfo?.availableLiquidity 
        ? formatBalance(liquidityInfo.availableLiquidity, "USDST", 18, 2, 2)
        : "0.00 USDST",
      totalCollateralValue: liquidityInfo?.totalCollateralValue 
        ? formatBalance(liquidityInfo.totalCollateralValue, "USDST", 18, 2, 2)
        : "0.00 USDST",
      borrowIndex: borrowIndexFormatted,
      reservesAccrued: liquidityInfo?.reservesAccrued 
        ? formatBalance(liquidityInfo.reservesAccrued, "USDST", 18, 2, 2)
        : "0.00 USDST",
      yourMusdst: liquidityInfo?.withdrawable?.userBalance 
        ? formatBalance(liquidityInfo.withdrawable.userBalance, "mUSDST", 18, 2, 2)
        : "0.00 mUSDST",
      conversionRate: liquidityInfo?.exchangeRate 
        ? `1 mUSDST = ${formatUnits(liquidityInfo.exchangeRate, 18)} USDST`
        : "N/A",
      ...maxDisplays,
      depositFeeDisplay: feeMath.depositFeeDisplay,
      withdrawFeeDisplay: feeMath.withdrawFeeDisplay,
    };
  }, [liquidityInfo, maxDisplays, feeMath]);

  const refreshLendingData = useCallback((signal?: AbortSignal) => {
    if (!userAddress) return;
    fetchTokens(signal);
    refreshLiquidity(signal);
    fetchUsdstBalance(userAddress, signal);
  }, [userAddress, fetchTokens, refreshLiquidity, fetchUsdstBalance]);

  const handleLiquidityAction = useCallback(async (type: "deposit" | "withdraw") => {
    try {
      setIsProcessing(true);

      const isMaxSelected = (): boolean => {
        try {
          const parsedAmount = safeParseUnits(withdrawAmount || "0", 18);
          // Compare to withdrawMaxAmount (BigInt) after normalizing decimals
          return parsedAmount === withdrawMaxAmount;
        } catch {
          return false;
        }
      };

      const amount = type === "deposit" ? depositAmount : withdrawAmount;
      const amountWei = safeParseUnits(amount, 18).toString();
      if (type === "withdraw" && isMaxSelected()) {
        await withdrawLiquidityAll();
      } else {
        await (type === "deposit" ? depositLiquidity : withdrawLiquidity)({
          amount: amountWei,
        });
      }

      toast({
        title:
          type === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description: `You have successfully ${type === "deposit" ? "deposited" : "withdrawn"} ${amount} USDST.`,
        variant: "success",
      });

      if (type === "deposit") {
        setDepositAmount("");
        setDepositAmountError("");
      } else {
        setWithdrawAmount("");
        setWithdrawAmountError("");
      }

      refreshLendingData();
    } catch (error) {
      // Error toast is now handled globally by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  }, [depositAmount, withdrawAmount, withdrawMaxAmount, withdrawLiquidityAll, depositLiquidity, withdrawLiquidity, toast, refreshLendingData]);

  // Unified Max logic
  const setMaxAmount = useCallback((amount: bigint, setAmount: (value: string) => void, setError: (error: string) => void) => {
    const maxAmount = formatUnits(amount, 18);
    setAmount(maxAmount);
    setError("");
  }, []);

  // Extracted handlers to avoid inline lambdas
  const onDepositChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    handleInput(
      value,
      setDepositAmount,
      setDepositAmountError,
      {
        maxAmount: depositMaxAmount,
        symbol: "USDST",
        tokenAddress: usdstAddress,
        transactionFee: LENDING_DEPOSIT_FEE,
      }
    );
  }, [handleInput, depositMaxAmount]);

  const onWithdrawChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    handleInput(
      value,
      setWithdrawAmount,
      setWithdrawAmountError,
      {
        maxAmount: withdrawMaxAmount,
        symbol: "mUSDST",
        tokenAddress: musdstAddress,
        transactionFee: LENDING_WITHDRAW_FEE,
      }
    );
  }, [handleInput, withdrawMaxAmount]);

  const onSetDepositMax = useCallback(() => {
    setMaxAmount(maxDepositTransferable, setDepositAmount, setDepositAmountError);
  }, [setMaxAmount, maxDepositTransferable]);

  const onSetWithdrawMax = useCallback(() => {
    setMaxAmount(maxWithdrawTransferable, setWithdrawAmount, setWithdrawAmountError);
  }, [setMaxAmount, maxWithdrawTransferable]);

  const onDeposit = useCallback(() => {
    handleLiquidityAction("deposit");
  }, [handleLiquidityAction]);

  const onWithdraw = useCallback(() => {
    handleLiquidityAction("withdraw");
  }, [handleLiquidityAction]);

  // 1. Fetch on userAddress change only, with abort controller
  useEffect(() => {
    if (!userAddress) return;
    
    // Abort previous fetch if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller
    abortControllerRef.current = new AbortController();
    refreshLendingData(abortControllerRef.current.signal);
    
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null; // Clear the ref to avoid double-abort
      }
    };
  }, [userAddress, refreshLendingData]);


  return (
    <div>
      <Card className="mb-6 border-0 md:border shadow-none md:shadow-sm">
        <CardHeader className="px-2 py-2 md:px-6 md:py-6">
          <div className="flex justify-between items-center">
            <CardTitle>USDST Lending Pool</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-2 py-2 md:px-6 md:py-6">
          {/* User Stats */}
          <div className="bg-white rounded-lg p-4 border mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4">
              <h3 className="font-medium">Your Position</h3>
              <span className="text-sm text-gray-500 mt-1 sm:mt-0">{displayStrings.conversionRate}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                <span className="text-gray-500 text-sm sm:text-base">Your USDST</span>
                <span className="font-medium text-sm sm:text-base sm:text-right">
                  {loadingLiquidity ? (
                    <span className="text-gray-400 animate-pulse">Loading...</span>
                  ) : formatBalance(depositMaxAmount, "USDST", 18, 2, 2)}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                <span className="text-gray-500 text-sm sm:text-base">Your mUSDST</span>
                <span className="font-medium text-sm sm:text-base sm:text-right">
                  {loadingLiquidity ? (
                    <span className="text-gray-400 animate-pulse">Loading...</span>
                  ) : displayStrings.yourMusdst}
                </span>
              </div>
            </div>
          </div>

          {/* Pool Stats - Two columns on non-mobile */}
          <div className="bg-white rounded-lg p-4 border mb-6">
            <div className="flex justify-between mb-4">
              <h3 className="font-medium">Pool Stats</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total USDST Supplied</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : displayStrings.totalUSDSTSupplied}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total USDST Borrowed</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : displayStrings.totalBorrowed}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Utilization Rate</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.utilizationRate || '0'}%</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Available Liquidity</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : displayStrings.availableLiquidity}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total Collateral Value</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : displayStrings.totalCollateralValue}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Borrow Index</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : displayStrings.borrowIndex}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Reserves Accrued</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : displayStrings.reservesAccrued}
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
              </div>
            </div>
          </div>

          {/* Deposit and Withdraw - Side by side on non-mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-4 border">
              <h3 className="font-medium mb-3">
                Deposit
                <>{" ("}
                  <button
                    type="button"
                    onClick={onSetDepositMax}
                    disabled={!userAddress || maxDepositTransferable === 0n}
                    className={`font-medium focus:outline-none ${
                      (!userAddress || maxDepositTransferable === 0n)
                        ? "text-gray-400 cursor-not-allowed" 
                        : "text-blue-600 hover:underline"
                    }`}
                  >
                    Max: {displayStrings.depositMaxDisplay}
                  </button>
                  {")"}</>
              </h3>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                <div className="relative flex-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={addCommasToInput(depositAmount)}
                    onChange={onDepositChange}
                    disabled={!userAddress || maxDepositTransferable === 0n}
                    aria-invalid={!!depositAmountError}
                    aria-busy={isProcessing}
                    className={`pl-16 ${depositAmountError ? 'border-red-500' : ''} ${(!userAddress || maxDepositTransferable === 0n) ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">USDST</span>
                </div>
                <Button
                  onClick={onDeposit}
                  className="bg-strato-blue hover:bg-strato-blue/90 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
                  disabled={!userAddress || loading || isProcessing || !depositAmount || !!depositAmountError}
                  aria-busy={isProcessing}
                >
                  {isProcessing ? (
                    "Processing..."
                  ) : (
                    <>
                      <CircleArrowDown className="mr-2 h-4 w-4" />
                      Deposit
                    </>
                  )}
                </Button>
              </div>
              {depositAmountError && <p className="text-sm text-red-500 mt-1">{depositAmountError}</p>}
              <div className="text-xs text-gray-500 mt-1">
                Transaction Fee: {displayStrings.depositFeeDisplay}
              </div>
              {/* Mobile Button */}
              <Button
                onClick={onDeposit}
                className="bg-strato-blue hover:bg-strato-blue/90 w-full mt-4 sm:hidden"
                disabled={!userAddress || loading || isProcessing || !depositAmount || !!depositAmountError}
                aria-busy={isProcessing}
              >
                {isProcessing ? (
                  "Processing..."
                ) : (
                  <>
                    <CircleArrowDown className="mr-2 h-4 w-4" />
                    Deposit
                  </>
                )}
              </Button>
            </div>

            <div className="bg-white rounded-lg p-4 border">
              <h3 className="font-medium mb-3">
                Withdraw
                <>{" ("}
                  <button
                    type="button"
                    onClick={onSetWithdrawMax}
                    disabled={!userAddress || maxWithdrawTransferable === 0n}
                    className={`font-medium focus:outline-none ${
                      (!userAddress || maxWithdrawTransferable === 0n)
                        ? "text-gray-400 cursor-not-allowed" 
                        : "text-blue-600 hover:underline"
                    }`}
                  >
                    Max: {displayStrings.withdrawMaxDisplay}
                  </button>
                  {")"}</>
              </h3>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                <div className="relative flex-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={addCommasToInput(withdrawAmount)}
                    onChange={onWithdrawChange}
                    disabled={!userAddress || maxWithdrawTransferable === 0n}
                    aria-invalid={!!withdrawAmountError}
                    aria-busy={isProcessing}
                    className={`pl-16 ${withdrawAmountError ? 'border-red-500' : ''} ${(!userAddress || maxWithdrawTransferable === 0n) ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">mUSDST</span>
                </div>
                <Button
                  onClick={onWithdraw}
                  variant="outline"
                  className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
                  disabled={
                    !userAddress ||
                    loadingLiquidity ||
                    isProcessing ||
                    !withdrawAmount ||
                    !!withdrawAmountError
                  }
                  aria-busy={isProcessing}
                >
                  {isProcessing ? (
                    "Processing..."
                  ) : (
                    <>
                      <CircleArrowUp className="mr-2 h-4 w-4" />
                      Withdraw
                    </>
                  )}
                </Button>
              </div>
              {withdrawAmountError && <p className="text-sm text-red-500 mt-1">{withdrawAmountError}</p>}
              <div className="text-xs text-gray-500 mt-1">
                Transaction Fee: {displayStrings.withdrawFeeDisplay}
              </div>
              {/* Mobile Button */}
              <Button
                onClick={onWithdraw}
                variant="outline"
                className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full mt-4 sm:hidden"
                disabled={
                  !userAddress ||
                  loadingLiquidity ||
                  isProcessing ||
                  !withdrawAmount ||
                  !!withdrawAmountError
                }
                aria-busy={isProcessing}
              >
                {isProcessing ? (
                  "Processing..."
                ) : (
                  <>
                    <CircleArrowUp className="mr-2 h-4 w-4" />
                    Withdraw
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LendingPoolSection;
