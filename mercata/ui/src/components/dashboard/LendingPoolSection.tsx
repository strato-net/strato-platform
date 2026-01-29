import { formatUnits } from "ethers";
import { CircleArrowDown, CircleArrowUp, HelpCircle, PauseCircle } from "lucide-react";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { LENDING_DEPOSIT_FEE, LENDING_WITHDRAW_FEE } from "@/lib/constants";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { rewardsEnabled } from "@/lib/constants";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

const LendingPoolSection = () => {
  const { isLoggedIn } = useUser();
  const { activeTokens: tokens, loading, fetchTokens } = useUserTokens();
  const { fetchUsdstBalance } = useTokenContext();
  const {
    liquidityInfo,
    loadingLiquidity,
    refreshLiquidity,
    depositLiquidity,
    withdrawLiquidity,
    withdrawLiquidityAll,
  } = useLendingContext();
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [stakeMToken, setStakeMToken] = useState<boolean>(rewardsEnabled ? true : false);
  const { toast } = useToast();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  const refreshLendingData = (signal?: AbortSignal) => {
    // Pool stats are public - always fetch
    refreshLiquidity(signal);
    // User-specific data - only fetch when logged in
    if (isLoggedIn) {
      fetchTokens(signal);
      fetchUsdstBalance();
    }
  };

  const getMaxWithdrawableAmount = (): bigint => {
    // Use only unstaked mUSDST (already includes pool limits)
    return BigInt(liquidityInfo?.withdrawable?.maxWithdrawableUSDST || "0");
  };

  // 1. Fetch on mount, with abort controller
  useEffect(() => {
    const abortController = new AbortController();
    refreshLendingData(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, []);


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
      const maxWithdrawableWei = getMaxWithdrawableAmount();
      const feeWei = safeParseUnits(LENDING_WITHDRAW_FEE, 18);
      const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");

      if (amountWei <= 0n) return false;
      if (amountWei > maxWithdrawableWei) return false;
      if (usdstBalanceWei < feeWei) return false;
      return true;
    } catch {
      return false;
    }
  };

  const handleLiquidityAction = async (type: "deposit" | "withdraw") => {try {
      setIsProcessing(true);

      const isMaxSelected = (): boolean => {
        try {
          const rhs = safeParseUnits(withdrawAmount || "0", 18);
          const lhs = BigInt(liquidityInfo?.withdrawable?.maxWithdrawableUSDST || "0");
          return rhs === lhs;
        } catch {
          return false;
        }
      };

      const amount = type === "deposit" ? depositAmount : withdrawAmount;
      const amountWei = safeParseUnits(amount, 18).toString();
      if (type === "withdraw" && isMaxSelected()) {
        await withdrawLiquidityAll();
      } else {
        if (type === "deposit") {
          await depositLiquidity({
            amount: amountWei,
            stakeMToken,
          });
        } else {
          await withdrawLiquidity({
            amount: amountWei,
          });
        }
      }

      toast({
        title:
          type === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description: `You have successfully ${type === "deposit" ? "deposited" : "withdrawn"} ${amount} USDST.`,
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
                <div className="bg-card rounded-lg p-4 border border-border">
                  <h3 className="font-medium mb-3">Deposit</h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className={`pl-16 ${!isDepositAmountValid() ? 'text-red-600' : ''}`}
                        disabled={!isLoggedIn}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">USDST</span>
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("deposit")}
                      className="bg-strato-blue hover:bg-strato-blue/90 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
                      disabled={loading || isProcessing || !isDepositAmountValid() || !isLoggedIn}
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
                  <div className="text-sm text-muted-foreground mt-1">
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
                      <span className="text-muted-foreground animate-pulse">
                        Loading...
                      </span>
                      : liquidityInfo?.supplyable?.userBalance
                        ? formatBalance(liquidityInfo.supplyable.userBalance || 0n, undefined, 18, 2)
                        : "0.00"}{" "}
                    USDST
                  </div>
                  {/* Fee Display */}
                  <div className="text-sm text-muted-foreground mt-1">
                    Transaction Fee: {LENDING_DEPOSIT_FEE} USDST
                  </div>
                  {/* Estimated Rewards */}
                  <RewardsWidget
                    userRewards={userRewards}
                    activityName="Lending Pool Liquidity"
                    inputAmount={depositAmount}
                    actionLabel="Deposit"
                  />
                  {/* Stake mUSDST Checkbox */}
                  {rewardsEnabled && (
                    <div className="flex items-center space-x-2 mt-3">
                      <Checkbox
                        id="stake-musdst"
                        checked={stakeMToken}
                        onCheckedChange={(checked) => setStakeMToken(checked as boolean)}
                      />
                      <label
                        htmlFor="stake-musdst"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        Stake my mUSDST to earn rewards
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs text-sm">
                            When providing liquidity to the pool, you'll receive equivalent mUSDST tokens.
                            If this option is enabled, these tokens will be automatically staked in the rewards program.
                            The longer the tokens are staked, the more rewards they accrue.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
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
                    disabled={loading || isProcessing || !isDepositAmountValid() || !isLoggedIn}
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

                <div className="bg-card rounded-lg p-4 border border-border">
                  <h3 className="font-medium mb-3">Withdraw</h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        className={`pl-16 ${!isWithdrawAmountValid() ? 'text-red-600' : ''}`}
                        disabled={!isLoggedIn}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">USDST</span>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="w-full sm:w-28 hidden sm:inline-block">
                          <Button
                            onClick={() => handleLiquidityAction("withdraw")}
                            variant="outline"
                            className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full"
                            disabled={
                              loadingLiquidity ||
                              isProcessing ||
                              !isWithdrawAmountValid() ||
                              liquidityInfo?.isPaused ||
                              !isLoggedIn
                            }
                          >
                            {isProcessing ? (
                              "Processing..."
                            ) : (
                              <>
                                {liquidityInfo?.isPaused ? (
                                  <PauseCircle className="mr-2 h-4 w-4" />
                                ) : (
                                  <CircleArrowUp className="mr-2 h-4 w-4" />
                                )}
                                Withdraw
                              </>
                            )}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {liquidityInfo?.isPaused && (
                        <TooltipContent className="bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900 text-orange-900 dark:text-orange-400">
                          <p>Lending Pool is on pause. This action currently disabled.</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const usdstBalanceWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                        const feeWei = safeParseUnits(LENDING_WITHDRAW_FEE, 18);

                        if (usdstBalanceWei < feeWei) return;

                        const maxWithdrawableWei = getMaxWithdrawableAmount();

                        if (maxWithdrawableWei <= 0n) return;

                        const formatted = formatUnits(maxWithdrawableWei, 18);
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
                    {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">
                        Loading...
                      </span>
                    ) : (
                      formatBalance(getMaxWithdrawableAmount(), undefined, 18, 2)
                    )}{" "}
                    USDST ({liquidityInfo?.withdrawable?.userBalance ? formatBalance(liquidityInfo?.withdrawable?.userBalance || 0n,"mUSDST", 18) : "0.00"})
                  </div>
                  {/* Fee Display */}
                  <div className="text-sm text-muted-foreground mt-1">
                    Transaction Fee: {LENDING_WITHDRAW_FEE} USDST
                  </div>
                  {/* Estimated Rewards Display */}
                  <RewardsWidget
                    userRewards={userRewards}
                    activityName="Lending Pool Liquidity"
                    inputAmount={withdrawAmount}
                    isWithdrawal={true}
                    actionLabel="Withdraw"
                  />
                  {/* Withdraw Amount Warning */}
                  {(() => {
                    const withdrawAmountWei = withdrawAmount ? safeParseUnits(withdrawAmount, 18) : 0n;
                    const maxWithdrawableWei = getMaxWithdrawableAmount();

                    // Check if withdraw amount exceeds withdrawable limit
                    const isInsufficientWithdrawable = withdrawAmountWei > 0n && withdrawAmountWei > maxWithdrawableWei;

                    return isInsufficientWithdrawable ? (
                      <p className="text-red-600 text-sm mt-1">
                        Insufficient balance - amount exceeds withdrawable limit ({formatBalance(maxWithdrawableWei, "USDST", 18, 2)} available)
                      </p>
                    ) : null;
                  })()}
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="w-full mt-4 sm:hidden block">
                        <Button
                          onClick={() => handleLiquidityAction("withdraw")}
                          variant="outline"
                          className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full"
                          disabled={
                            loadingLiquidity ||
                            isProcessing ||
                            !isWithdrawAmountValid() ||
                            liquidityInfo?.isPaused ||
                            !isLoggedIn
                          }
                        >
                          {isProcessing ? (
                            "Processing..."
                          ) : (
                            <>
                              {liquidityInfo?.isPaused ? (
                                <PauseCircle className="mr-2 h-4 w-4" />
                              ) : (
                                <CircleArrowUp className="mr-2 h-4 w-4" />
                              )}
                              Withdraw
                            </>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {liquidityInfo?.isPaused && (
                      <TooltipContent className="bg-orange-500/10 border-orange-500/30 text-orange-500">
                        <p>Lending Pool is on pause. This action currently disabled.</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </div>
              </div>
            </div>

                <div className="bg-card rounded-lg p-4 border border-border">
              <div className="flex justify-between mb-4">
                <h3 className="font-medium">Pool Stats</h3>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Total USDST Supplied</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">
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
                  <span className="text-muted-foreground text-sm sm:text-base">Total USDST Borrowed</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">
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
                  <span className="text-muted-foreground text-sm sm:text-base">Utilization Rate</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.utilizationRate || '0'}%</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Available Liquidity</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                     {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">
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
                  <span className="text-muted-foreground text-sm sm:text-base">Total Collateral Value</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">
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
                  <span className="text-muted-foreground text-sm sm:text-base">Borrow Index</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">Loading...</span>
                    ) : liquidityInfo?.borrowIndex ? (
                      (() => {
                        const s = formatUnits(liquidityInfo.borrowIndex || 0, 27);
                        const [w, f = ""] = s.split(".");
                        return f ? `${w}.${f.slice(0, 5)}` : w;
                      })()
                    ) : (
                      "0"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Reserves Accrued</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loadingLiquidity ? (
                      <span className="text-muted-foreground animate-pulse">Loading...</span>
                    ) : liquidityInfo?.reservesAccrued ? (
                      formatBalance(liquidityInfo.reservesAccrued || 0n, undefined, 18, 2, 2, true)
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Supply APY</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.supplyAPY ? `${liquidityInfo.supplyAPY}%` : "N/A"}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Max Supply APY</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.maxSupplyAPY ? `${liquidityInfo.maxSupplyAPY}%` : "N/A"}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Borrow APY</span>
                  <span className="font-medium text-sm sm:text-base">{liquidityInfo?.borrowAPY ? `${liquidityInfo.borrowAPY}%` : "N/A"}</span>
                </div>
                {/* User-specific data - only show when logged in */}
                {isLoggedIn && (
                  <>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                      <span className="text-muted-foreground text-sm sm:text-base">Your mUSDST (Total)</span>
                      <span className="font-medium text-sm sm:text-base sm:text-right">
                        {loadingLiquidity ? (
                          <span className="text-muted-foreground animate-pulse">
                            Loading...
                          </span>
                        ) : liquidityInfo?.withdrawable?.userBalance ? (
                          formatBalance(liquidityInfo.withdrawable.userBalance || 0n, undefined, 18, 2, 2)
                        ) : (
                          "0.00"
                        )}
                      </span>
                    </div>
                    {rewardsEnabled && (
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start pl-4">
                        <span className="text-muted-foreground text-xs sm:text-sm">• Unstaked</span>
                        <span className="font-medium text-xs sm:text-sm sm:text-right">
                          {loadingLiquidity ? (
                            <span className="text-muted-foreground animate-pulse">
                              Loading...
                            </span>
                          ) : liquidityInfo?.withdrawable?.userBalance ? (
                            formatBalance(liquidityInfo.withdrawable.userBalance || 0n, undefined, 18, 2, 2)
                          ) : (
                            "0.00"
                          )}
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-muted-foreground text-sm sm:text-base">Conversion Rate</span>
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
