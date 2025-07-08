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
    fetchTokens(userAddress, signal);
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
      if (amountWei <= 0n) return false;
      if (amountWei > availableWei) return false;
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
      const depositedBalanceWei = BigInt(liquidityInfo?.withdrawable?.maxWithdrawableUSDST) ?? 0n;
      if (amountWei <= 0n) return false;
      if (amountWei > depositedBalanceWei) return false;
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
    } catch (error: any) {
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
      <Card className="mb-6">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>USDST Lending Pool</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-4 border">
              <div className="flex justify-between mb-4">
                <h3 className="font-medium">Pool Stats</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total USDST Supplied</span>
                  <span className="font-medium">
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
                <div className="flex justify-between">
                  <span className="text-gray-500">Total USDST Borrowed</span>
                  <span className="font-medium">
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
                <div className="flex justify-between">
                  <span className="text-gray-500">Utilization Rate</span>
                  <span className="font-medium">{liquidityInfo?.utilizationRate || '0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Available Liquidity</span>
                  <span className="font-medium">
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
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Collateral Value</span>
                  <span className="font-medium">
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
                <div className="flex justify-between">
                  <span className="text-gray-500">Supply APY</span>
                  <span className="font-medium">{liquidityInfo?.supplyAPY || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Borrow APY</span>
                  <span className="font-medium">{liquidityInfo?.borrowAPY || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Your mUSDST</span>
                  <span className="font-medium">
                    {loadingLiquidity ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : liquidityInfo?.withdrawable?.userBalance ? (
                      `$${Number(
                        formatUnits(liquidityInfo?.withdrawable?.userBalance || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "$0.00"
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Conversion Rate</span>
                  <span className="font-medium">{liquidityInfo?.conversionRate ? "1 mUSDST = " + liquidityInfo?.conversionRate + " USDST" : "N/A"}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex flex-col space-y-4">
                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Deposit</h3>
                  <div className="flex items-center space-x-2">
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
                      className="bg-strato-blue hover:bg-strato-blue/90"
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
                </div>

                <div className="bg-white rounded-lg p-4 border">
                  <h3 className="font-medium mb-3">Withdraw</h3>
                  <div className="flex items-center space-x-2">
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
                      className="border-strato-blue text-strato-blue hover:bg-strato-blue/10"
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
                        ? Number(
                          formatUnits(liquidityInfo?.withdrawable?.maxWithdrawableUSDST || 0, 18)
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 4,
                        })
                        : "0.00"}{" "}
                    USDST
                  </div>
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
