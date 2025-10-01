import { formatUnits } from "ethers";
import { CircleArrowDown, CircleArrowUp, Clock, Shield } from "lucide-react";
import { useSafetyContext } from "@/context/SafetyContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { SAFETY_STAKE_FEE, SAFETY_REDEEM_FEE, usdstAddress, safetyModuleAddress } from "@/lib/constants";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";

const SafetyModuleSection = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, loading: tokensLoading, fetchTokens, fetchUsdstBalance, usdstBalance } = useUserTokens();
  const { approveToken } = useTokenContext();
  const {
    safetyInfo,
    loading,
    refreshSafetyInfo,
    stakeSafety,
    startCooldown,
    redeemSafety,
    redeemAllSafety,
  } = useSafetyContext();
  const [stakeAmount, setStakeAmount] = useState<string>("");
  const [redeemAmount, setRedeemAmount] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();


  const refreshData = (signal?: AbortSignal) => {
    if (!userAddress) return;
    fetchTokens(signal);
    refreshSafetyInfo(signal);
    fetchUsdstBalance(userAddress);
  };

  // Fetch on userAddress change only, with abort controller
  useEffect(() => {
    if (!userAddress) return;
    const abortController = new AbortController();
    refreshData(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, [userAddress]);

  // usdstBalance is now coming directly from useUserTokens() context

  const isStakeAmountValid = () => {
    if (!stakeAmount) return false;
    if (!/^\d+(\.\d{1,18})?$/.test(stakeAmount)) return false;
    try {
      const amountWei = safeParseUnits(stakeAmount, 18);
      const availableWei = BigInt(usdstBalance);
      const feeWei = safeParseUnits(SAFETY_STAKE_FEE, 18);
      
      if (amountWei <= 0n) return false;
      if (amountWei > availableWei) return false;
      if (amountWei + feeWei > availableWei) return false;
      return true;
    } catch {
      return false;
    }
  };


  const isRedeemAmountValid = () => {
    if (!redeemAmount) return false;
    if (!/^\d+(\.\d{1,18})?$/.test(redeemAmount)) return false;
    try {
      const amountWei = safeParseUnits(redeemAmount, 18);
      const userSharesWei = BigInt(safetyInfo?.userShares || "0");
      const usdstBalanceWei = BigInt(usdstBalance);
      const feeWei = safeParseUnits(SAFETY_REDEEM_FEE, 18);
      
      if (amountWei <= 0n) return false;
      if (amountWei > userSharesWei) return false; // Check against user's sUSDST balance
      if (usdstBalanceWei < feeWei) return false; // Must have USDST for fee
      return true;
    } catch {
      return false;
    }
  };

  const handleStakeAction = async () => {
    try {
      setIsProcessing(true);
      const amountWei = safeParseUnits(stakeAmount, 18).toString();
      
      // First, approve the SafetyModule contract to spend USDST
      
      toast({
        title: "Approving USDST...",
        description: "Please approve the SafetyModule to spend your USDST tokens.",
        variant: "default",
      });

      // Approve the SafetyModule to spend the stake amount
      await approveToken({
        address: usdstAddress,
        spender: safetyModuleAddress,
        value: amountWei
      });

      toast({
        title: "Approval Successful",
        description: "Now staking your USDST...",
        variant: "success",
      });

      // Then stake the tokens
      await stakeSafety({ amount: amountWei });

      toast({
        title: "Stake Successful",
        description: `You have successfully staked ${stakeAmount} USDST for sUSDST.`,
        variant: "success",
      });

      setStakeAmount("");
      refreshData();
    } catch (error) {
      // Error toast is handled globally by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartCooldown = async () => {
    try {
      setIsProcessing(true);
      await startCooldown();

      toast({
        title: "Cooldown Started",
        description: "Your unstaking cooldown period has started. You can redeem after the cooldown completes.",
        variant: "success",
      });

      refreshData();
    } catch (error) {
      // Error toast is handled globally by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRedeemAction = async (type: "redeem" | "redeemAll") => {
    try {
      setIsProcessing(true);

      const isMaxSelected = (): boolean => {
        try {
          const rhs = safeParseUnits(redeemAmount || "0", 18);
          const lhs = BigInt(safetyInfo?.userShares || "0");
          return rhs === lhs;
        } catch {
          return false;
        }
      };

      if (type === "redeemAll" || isMaxSelected()) {
        await redeemAllSafety();
      } else {
        const sharesAmountWei = safeParseUnits(redeemAmount, 18).toString();
        await redeemSafety({ sharesAmount: sharesAmountWei });
      }

      toast({
        title: "Redeem Successful",
        description: `You have successfully redeemed sUSDST for USDST.`,
        variant: "success",
      });

      setRedeemAmount("");
      refreshData();
    } catch (error) {
      // Error toast is handled globally by axios interceptor
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTimeRemaining = (seconds: string): string => {
    const totalSeconds = parseInt(seconds);
    if (totalSeconds <= 0) return "Completed";

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const leftoverSeconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m ${leftoverSeconds}s`;
    if (hours > 0) return `${hours}h ${minutes}m ${leftoverSeconds}s`;
    if (minutes > 0) return `${minutes}m ${leftoverSeconds}s`;
    return `${leftoverSeconds}s`;
  };

  return (
    <div>
      <Card className="mb-6 border-0 md:border shadow-none md:shadow-sm">
        <CardHeader className="px-2 py-2 md:px-6 md:py-6">
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              USDST Safety Module
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-2 py-2 md:px-6 md:py-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="flex flex-col space-y-4">
                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Stake</h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                    <div className="relative flex-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        className={`pl-16 ${!isStakeAmountValid() ? 'text-red-600' : ''}`}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">USDST</span>
                    </div>
                    <Button
                      onClick={handleStakeAction}
                      className="bg-strato-blue hover:bg-strato-blue/90 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
                      disabled={tokensLoading || isProcessing || !isStakeAmountValid()}
                    >
                      {isProcessing ? (
                        "Processing..."
                      ) : (
                        <>
                          <CircleArrowDown className="mr-2 h-4 w-4" />
                          Stake
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const availableWei = BigInt(usdstBalance);
                        const feeWei = safeParseUnits(SAFETY_STAKE_FEE, 18);
                        const maxStakeableWei = availableWei > feeWei ? availableWei - feeWei : 0n;
                        const formatted = formatUnits(maxStakeableWei, 18);

                        // Clamp to 18 decimals
                        const [whole, frac = ""] = formatted.split(".");
                        const clamped = `${whole}.${frac.slice(0, 18)}`;
                        setStakeAmount(clamped);
                      }}
                      className="text-blue-600 hover:underline mr-2"
                    >
                      Max
                    </button>
                    Available:{" "}
                    {tokensLoading ?
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                      : usdstBalance
                        ? formatBalance(usdstBalance || 0n, undefined, 18, 2)
                        : "0.00"}{" "}
                    USDST
                  </div>
                  {/* Fee Display */}
                  <div className="text-sm text-gray-500 mt-1">
                    Transaction Fee: {SAFETY_STAKE_FEE} USDST
                  </div>
                  {/* Fee Warning */}
                  {(() => {
                    const availableWei = BigInt(usdstBalance);
                    const feeWei = safeParseUnits(SAFETY_STAKE_FEE, 18);
                    const stakeAmountWei = stakeAmount ? safeParseUnits(stakeAmount, 18) : 0n;
                    
                    const isInsufficientUsdstForFee = !tokensLoading && availableWei < feeWei;
                    const isInsufficientBalanceForStakeAndFee = !tokensLoading && stakeAmountWei + feeWei > availableWei && stakeAmountWei <= availableWei;
                    
                    const lowBalanceThreshold = safeParseUnits("0.10", 18);
                    const remainingBalance = availableWei - stakeAmountWei - feeWei;
                    const isLowBalanceWarning = stakeAmountWei > 0n && remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                    
                    return (
                      <>
                        {isInsufficientBalanceForStakeAndFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Insufficient USDST balance for transaction fee ({SAFETY_STAKE_FEE} USDST)
                          </p>
                        )}
                        {isLowBalanceWarning && !isInsufficientUsdstForFee && !isInsufficientBalanceForStakeAndFee && (
                          <p className="text-yellow-600 text-sm mt-1">
                            Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {/* Mobile Button */}
                  <Button
                    onClick={handleStakeAction}
                    className="bg-strato-blue hover:bg-strato-blue/90 w-full mt-4 sm:hidden"
                    disabled={tokensLoading || isProcessing || !isStakeAmountValid()}
                  >
                    {isProcessing ? (
                      "Processing..."
                    ) : (
                      <>
                        <CircleArrowDown className="mr-2 h-4 w-4" />
                        Stake
                      </>
                    )}
                  </Button>
                </div>

                {/* Cooldown Section */}
                {safetyInfo && BigInt(safetyInfo.userShares) > 0n && (
                  <div className="bg-white rounded-lg p-4 border">
                    <h3 className="font-medium mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Unstaking
                    </h3>
                    
                    {!safetyInfo.cooldownActive ? (
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600">
                          Start your cooldown period to begin unstaking your sUSDST.
                        </p>
                        <Button
                          onClick={handleStartCooldown}
                          variant="outline"
                          className="border-orange-500 text-orange-600 hover:bg-orange-50 w-full"
                          disabled={isProcessing}
                        >
                          {isProcessing ? "Processing..." : "Start Cooldown"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {safetyInfo.cooldownTimeRemaining !== "0" ? (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-yellow-800">
                              <Clock className="h-4 w-4" />
                              <span className="font-medium">Cooldown Active</span>
                            </div>
                            <p className="text-sm text-yellow-700 mt-1">
                              Time remaining: {formatTimeRemaining(safetyInfo.cooldownTimeRemaining)}
                            </p>
                          </div>
                        ) : safetyInfo.unstakeWindowTimeRemaining !== "0" ? (
                          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-green-800">
                              <CircleArrowUp className="h-4 w-4" />
                              <span className="font-medium">Unstake Window Open</span>
                            </div>
                            <p className="text-sm text-green-700 mt-1">
                              Window closes in: {formatTimeRemaining(safetyInfo.unstakeWindowTimeRemaining)}
                            </p>
                          </div>
                        ) : (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-red-800">
                              <span className="font-medium">Unstake Window Closed</span>
                            </div>
                            <p className="text-sm text-red-700 mt-1">
                              You need to start a new cooldown period.
                            </p>
                            <Button
                              onClick={handleStartCooldown}
                              variant="outline"
                              className="border-orange-500 text-orange-600 hover:bg-orange-50 w-full mt-2"
                              disabled={isProcessing}
                            >
                              {isProcessing ? "Processing..." : "Restart Cooldown"}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Redeem Section */}
                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Redeem</h3>
                  
                  {/* Show redemption status */}
                  {safetyInfo && BigInt(safetyInfo.userShares) === 0n ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
                      <p className="text-sm text-gray-600">
                        No sUSDST shares to redeem. Stake USDST first to receive sUSDST shares.
                      </p>
                    </div>
                  ) : !safetyInfo?.canRedeem ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
                      <p className="text-sm text-yellow-800">
                        {!safetyInfo?.cooldownActive 
                          ? "Start cooldown period before you can redeem your sUSDST."
                          : safetyInfo.cooldownTimeRemaining !== "0"
                          ? "Cooldown in progress. You can redeem after the cooldown completes."
                          : "Unstake window has expired. Start a new cooldown to redeem."
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                      <p className="text-sm text-green-800">
                        ✓ Unstake window is open. You can now redeem your sUSDST for USDST.
                      </p>
                    </div>
                  )}

                  {safetyInfo && BigInt(safetyInfo.userShares) > 0n && (
                    <>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-start space-y-2 sm:space-y-0 sm:space-x-2">
                        <div className="relative flex-1">
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={redeemAmount}
                            onChange={(e) => setRedeemAmount(e.target.value)}
                            className={`pl-16 ${!isRedeemAmountValid() ? 'text-red-600' : ''}`}
                            disabled={!safetyInfo?.canRedeem || BigInt(safetyInfo?.userShares || "0") === 0n}
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">sUSDST</span>
                        </div>
                        <Button
                          onClick={() => handleRedeemAction("redeem")}
                          variant="outline"
                          className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full sm:w-28 hidden sm:flex sm:items-center sm:justify-center"
                          disabled={loading || isProcessing || !isRedeemAmountValid() || !safetyInfo?.canRedeem}
                        >
                          {isProcessing ? (
                            "Processing..."
                          ) : (
                            <>
                              <CircleArrowUp className="mr-2 h-4 w-4" />
                              Redeem
                            </>
                          )}
                        </Button>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const userSharesWei = BigInt(safetyInfo?.userShares || "0");
                          if (userSharesWei <= 0n) return;

                          const formatted = formatUnits(userSharesWei, 18);
                          const [w, f = ""] = formatted.split(".");
                          const clamped = f.length > 18 ? `${w}.${f.slice(0, 18)}` : formatted;
                          const clampedClean = clamped.replace(/\.?0+$/, "");

                          setRedeemAmount(clampedClean);
                        }}
                        className={`mr-2 ${safetyInfo?.canRedeem && BigInt(safetyInfo?.userShares || "0") > 0n 
                          ? "text-blue-600 hover:underline cursor-pointer" 
                          : "text-gray-400 cursor-not-allowed"}`}
                        disabled={!safetyInfo?.canRedeem || BigInt(safetyInfo?.userShares || "0") === 0n}
                      >
                        Max
                      </button>
                      Available:{" "}
                      {loading ?
                        <span className="text-gray-400 animate-pulse">
                          Loading...
                        </span>
                        : safetyInfo?.userShares
                          ? formatBalance(safetyInfo.userShares || 0n, undefined, 18, 2)
                          : "0.00"}{" "}
                      sUSDST
                    </div>
                    {/* Fee Display */}
                    <div className="text-sm text-gray-500 mt-1">
                      Transaction Fee: {SAFETY_REDEEM_FEE} USDST
                    </div>
                    {/* Mobile Button */}
                    <Button
                      onClick={() => handleRedeemAction("redeem")}
                      variant="outline"
                      className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 w-full mt-4 sm:hidden"
                      disabled={loading || isProcessing || !isRedeemAmountValid() || !safetyInfo?.canRedeem}
                    >
                      {isProcessing ? (
                        "Processing..."
                      ) : (
                        <>
                          <CircleArrowUp className="mr-2 h-4 w-4" />
                          Redeem
                        </>
                      )}
                    </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-4 border">
              <div className="flex justify-between mb-4">
                <h3 className="font-medium">Safety Module Stats</h3>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total USDST Staked</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loading ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : safetyInfo ? (
                      formatBalance(safetyInfo.totalAssets || 0n, undefined, 18, 2, 2, true)
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Total sUSDST Shares</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loading ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : safetyInfo?.totalShares ? (
                      formatBalance(safetyInfo.totalShares || 0n, undefined, 18, 2, 2)
                    ) : (
                      "0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Exchange Rate</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loading ? (
                      <span className="text-gray-400 animate-pulse">Loading...</span>
                    ) : safetyInfo?.exchangeRate ? (
                      "1 sUSDST ≈ " + formatUnits(safetyInfo?.exchangeRate || 0, 18) + " USDST"
                    ) : (
                      "1 sUSDST = 1 USDST"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Your sUSDST Shares</span>
                  <span className="font-medium text-sm sm:text-base sm:text-right">
                    {loading ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : safetyInfo?.userShares ? (
                      formatBalance(safetyInfo.userShares || 0n, undefined, 18, 2, 2)
                    ) : (
                      "0.00"
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Cooldown Period</span>
                  <span className="font-medium text-sm sm:text-base">
                    {safetyInfo?.cooldownSeconds ? 
                      formatTimeRemaining(safetyInfo.cooldownSeconds) : 
                      "N/A"
                    }
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                  <span className="text-gray-500 text-sm sm:text-base">Unstake Window</span>
                  <span className="font-medium text-sm sm:text-base">
                    {safetyInfo?.unstakeWindow ? 
                      formatTimeRemaining(safetyInfo.unstakeWindow) : 
                      "N/A"
                    }
                  </span>
                </div>
                {safetyInfo?.cooldownActive && (
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                    <span className="text-gray-500 text-sm sm:text-base">Cooldown Status</span>
                    <span className="font-medium text-sm sm:text-base sm:text-right">
                      {safetyInfo.cooldownTimeRemaining !== "0" ? (
                        <span className="text-yellow-600">
                          {formatTimeRemaining(safetyInfo.cooldownTimeRemaining)} remaining
                        </span>
                      ) : safetyInfo.unstakeWindowTimeRemaining !== "0" ? (
                        <span className="text-green-600">
                          Window open ({formatTimeRemaining(safetyInfo.unstakeWindowTimeRemaining)} left)
                        </span>
                      ) : (
                        <span className="text-red-600">
                          Window closed
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SafetyModuleSection;
