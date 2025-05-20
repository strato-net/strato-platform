import { formatUnits, ethers } from "ethers";
import { DollarSign, ArrowDown, ArrowUp } from "lucide-react";
import api from "@/lib/axios";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Token, WithdrawableToken } from "@/interface";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";

const LendingPoolSection = () => {
  const { userAddress } = useUser();
  const { tokens, loading, fetchTokens } = useUserTokens();
  const {
    withdrawableTokens,
    loadingWithdrawableTokens,
    refreshWithdrawableTokens,
  } = useLendingContext();
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [usdstToken, setUsdstToken] = useState<Token | null>(null);
  const [usdstAvailableBalance, setUsdstAvailableBalance] =
    useState<string>("0");
  const [depositedUsdstToken, setDepositedUsdstToken] =
    useState<WithdrawableToken | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (userAddress) {
      fetchTokens(userAddress);
      refreshWithdrawableTokens();
    }
  }, [userAddress]);

  useEffect(() => {
    if (tokens && tokens.length > 0) {
      const usdst = tokens.find(
        (token) => token["BlockApps-Mercata-ERC20"]._symbol === "USDST"
      );
      if (usdst) {
        setUsdstToken(usdst);
        setUsdstAvailableBalance(formatUnits(usdst.value, 18));
      }
    }
  }, [tokens]);

  useEffect(() => {
    if (usdstToken && withdrawableTokens && withdrawableTokens.length > 0) {
      const match = withdrawableTokens.find(
        (token) =>
          token._symbol === "USDST" && token.address === usdstToken.address
      );
      if (match) {
        setDepositedUsdstToken(match);
      }
    }
  }, [withdrawableTokens, usdstToken]);

  const handleLiquidityAction = async (type: "deposit" | "withdraw") => {
    try {
      setIsProcessing(true);
      const amount = type === "deposit" ? depositAmount : withdrawAmount;
      const amountWei = ethers.parseUnits(amount, 18).toString();
      await api.post("/lend/manageLiquidity", {
        asset: usdstToken?.address,
        amount: amountWei,
        method: type === "deposit" ? "depositLiquidity" : "withdrawLiquidity",
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

      if (userAddress) {
        fetchTokens(userAddress);
        refreshWithdrawableTokens();
      }
    } catch (error: any) {
      toast({
        title: type === "deposit" ? "Deposit Error" : "Withdrawal Error",
        description: `Something went wrong - ${
          error?.message || "Please try again later."
        }`,
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
                  <span className="text-gray-500">Your deposit</span>
                  <span className="font-medium">
                    {loadingWithdrawableTokens ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : depositedUsdstToken ? (
                      `$${Number(
                        formatUnits(depositedUsdstToken.value || 0, 18)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      "$0.00"
                    )}
                  </span>
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
                        className="pl-8"
                      />
                      <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("deposit")}
                      className="bg-strato-blue hover:bg-strato-blue/90"
                      disabled={
                        loading ||
                        isProcessing ||
                        !depositAmount ||
                        parseFloat(depositAmount) <= 0
                      }
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
                    {loading ? (
                      <span className="text-gray-400 animate-pulse">
                        Loading...
                      </span>
                    ) : (
                      Number(usdstAvailableBalance).toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 4,
                      })
                    )}{" "}
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
                        className="pl-8"
                      />
                      <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                    </div>
                    <Button
                      onClick={() => handleLiquidityAction("withdraw")}
                      variant="outline"
                      className="border-strato-blue text-strato-blue hover:bg-strato-blue/10"
                      disabled={
                        loadingWithdrawableTokens ||
                        isProcessing ||
                        !withdrawAmount ||
                        parseFloat(withdrawAmount) <= 0
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
                    Deposited:{" "}
                    {depositedUsdstToken
                      ? Number(
                          formatUnits(depositedUsdstToken.value || 0, 18)
                        ).toLocaleString(undefined, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 4,
                        })
                      : "0.0000"}{" "}
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
