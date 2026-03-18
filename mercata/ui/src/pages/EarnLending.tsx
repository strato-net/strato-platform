import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { ArrowLeft, CircleArrowDown, CircleArrowUp, Gauge, HelpCircle, Landmark, PauseCircle, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUser } from "@/context/UserContext";
import { useLendingContext } from "@/context/LendingContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useToast } from "@/hooks/use-toast";
import { LENDING_DEPOSIT_FEE, LENDING_WITHDRAW_FEE, rewardsEnabled } from "@/lib/constants";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

const EarnLending = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const guestMode = !isLoggedIn;
  const { loading: tokensLoading, fetchTokens } = useUserTokens();
  const { fetchUsdstBalance } = useTokenContext();
  const {
    liquidityInfo,
    loadingLiquidity,
    refreshLiquidity,
    depositLiquidity,
    withdrawLiquidity,
    withdrawLiquidityAll,
  } = useLendingContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [stakeMToken, setStakeMToken] = useState<boolean>(rewardsEnabled);

  const refreshLendingData = (signal?: AbortSignal) => {
    refreshLiquidity(signal);
    if (isLoggedIn) {
      fetchTokens(signal);
      fetchUsdstBalance();
    }
  };

  const getMaxWithdrawableAmount = (): bigint => {
    return BigInt(liquidityInfo?.withdrawable?.maxWithdrawableUSDST || "0");
  };

  useEffect(() => {
    document.title = "STRATO Earn Lending | STRATO";
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    refreshLendingData(abortController.signal);
    return () => abortController.abort();
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

  const handleLiquidityAction = async (type: "deposit" | "withdraw") => {
    try {
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
      } else if (type === "deposit") {
        await depositLiquidity({ amount: amountWei, stakeMToken });
      } else {
        await withdrawLiquidity({ amount: amountWei });
      }

      toast({
        title: type === "deposit" ? "Deposit Successful" : "Withdrawal Successful",
        description: `You have successfully ${type === "deposit" ? "deposited" : "withdrawn"} ${amount} USDST.`,
        variant: "success",
      });

      if (type === "deposit") {
        setDepositAmount("");
      } else {
        setWithdrawAmount("");
      }
      refreshLendingData();
    } catch {
      // Error toast is handled globally.
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="Lending Pool" />

        <main className="pb-16 md:pb-6 p-4 md:p-6">
          {guestMode && (
            <GuestSignInBanner message="Sign in to deposit or withdraw from the lending pool" />
          )}

          <div className="mb-4">
            <button
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => navigate(-1)}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>

          <div className="space-y-5">
            <Card className="border border-border/70 bg-gradient-to-br from-blue-500/10 via-background to-background">
              <CardContent className="pt-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Earn Opportunity</p>
                    <h1 className="text-2xl md:text-3xl font-semibold mt-1">USDST Lending Pool</h1>
                    <p className="text-sm text-muted-foreground mt-1">Supply USDST liquidity and withdraw on demand.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">Supply APY</p>
                      <p className="text-sm font-semibold">{liquidityInfo?.supplyAPY ? `${liquidityInfo.supplyAPY}%` : "N/A"}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">TVL</p>
                      <p className="text-sm font-semibold">
                        {loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.totalUSDSTSupplied || 0n, undefined, 18, 2, 2, true)}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="xl:col-span-3 space-y-4">
                <Card className="border border-border/70">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold">Deposit</p>
                      <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Wallet className="h-3.5 w-3.5" />
                        USDST
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value)}
                          className={`pl-16 h-11 ${!isDepositAmountValid() && depositAmount ? "text-red-600" : ""}`}
                          disabled={!isLoggedIn}
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">USDST</span>
                      </div>
                      <Button
                        onClick={() => handleLiquidityAction("deposit")}
                        className="h-11 sm:w-36"
                        disabled={tokensLoading || isProcessing || !isDepositAmountValid() || !isLoggedIn}
                      >
                        {isProcessing ? "Processing..." : <><CircleArrowDown className="mr-2 h-4 w-4" />Deposit</>}
                      </Button>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => {
                          const availableWei = BigInt(liquidityInfo?.supplyable?.userBalance || "0");
                          const feeWei = safeParseUnits(LENDING_DEPOSIT_FEE, 18);
                          const maxDepositableWei = availableWei > feeWei ? availableWei - feeWei : 0n;
                          const formatted = formatUnits(maxDepositableWei, 18);
                          const [whole, frac = ""] = formatted.split(".");
                          setDepositAmount(`${whole}.${frac.slice(0, 18)}`);
                        }}
                        className="text-blue-600 hover:underline mr-2"
                      >
                        Max
                      </button>
                      Available: {loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.supplyable?.userBalance || 0n, undefined, 18, 2)} USDST
                    </div>

                    <div className="text-sm text-muted-foreground">Transaction Fee: {LENDING_DEPOSIT_FEE} USDST</div>

                    <RewardsWidget
                      userRewards={userRewards}
                      activityName="Lending Pool Liquidity"
                      inputAmount={depositAmount}
                      actionLabel="Deposit"
                    />

                    {rewardsEnabled && (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="stake-musdst-earn"
                          checked={stakeMToken}
                          onCheckedChange={(checked) => setStakeMToken(checked as boolean)}
                        />
                        <label htmlFor="stake-musdst-earn" className="text-sm font-medium">Stake my mUSDST to earn rewards</label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs text-sm">Automatically stake received mUSDST in rewards.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border border-border/70">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold">Withdraw</p>
                      <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Gauge className="h-3.5 w-3.5" />
                        Instant redemption
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          className={`pl-16 h-11 ${!isWithdrawAmountValid() && withdrawAmount ? "text-red-600" : ""}`}
                          disabled={!isLoggedIn}
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">USDST</span>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="sm:w-36 w-full">
                            <Button
                              onClick={() => handleLiquidityAction("withdraw")}
                              variant="outline"
                              className="h-11 w-full"
                              disabled={loadingLiquidity || isProcessing || !isWithdrawAmountValid() || liquidityInfo?.isPaused || !isLoggedIn}
                            >
                              {isProcessing ? "Processing..." : (
                                <>
                                  {liquidityInfo?.isPaused ? <PauseCircle className="mr-2 h-4 w-4" /> : <CircleArrowUp className="mr-2 h-4 w-4" />}
                                  Withdraw
                                </>
                              )}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        {liquidityInfo?.isPaused && (
                          <TooltipContent>
                            <p>Lending Pool is on pause. This action is disabled.</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </div>

                    <div className="text-sm text-muted-foreground">
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
                          setWithdrawAmount(clamped.replace(/\.?0+$/, ""));
                        }}
                        className="text-blue-600 hover:underline mr-2"
                      >
                        Max
                      </button>
                      Withdrawable: {loadingLiquidity ? "Loading..." : formatBalance(getMaxWithdrawableAmount(), undefined, 18, 2)} USDST
                    </div>

                    <div className="text-sm text-muted-foreground">Transaction Fee: {LENDING_WITHDRAW_FEE} USDST</div>

                    <RewardsWidget
                      userRewards={userRewards}
                      activityName="Lending Pool Liquidity"
                      inputAmount={withdrawAmount}
                      isWithdrawal
                      actionLabel="Withdraw"
                    />
                  </CardContent>
                </Card>
              </div>

              <div className="xl:col-span-2">
                <Card className="border border-border/70 h-full">
                  <CardContent className="pt-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Landmark className="h-4 w-4 text-blue-600" />
                      <p className="text-base font-semibold">Pool Stats</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5">
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Total USDST Supplied</p><p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.totalUSDSTSupplied || 0n, undefined, 18, 2, 2, true)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Total USDST Borrowed</p><p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.totalBorrowed || 0n, undefined, 18, 2, 2, true)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Utilization Rate</p><p className="text-sm font-semibold">{liquidityInfo?.utilizationRate || "0"}%</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Available Liquidity</p><p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.availableLiquidity || 0n, undefined, 18, 2, 2, true)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Total Collateral Value</p><p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.totalCollateralValue || 0n, undefined, 18, 2, 2, true)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Borrow Index</p><p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : liquidityInfo?.borrowIndex ? (() => { const s = formatUnits(liquidityInfo.borrowIndex || 0, 27); const [w, f = ""] = s.split("."); return f ? `${w}.${f.slice(0, 5)}` : w; })() : "0"}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Reserves Accrued</p><p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.reservesAccrued || 0n, undefined, 18, 2, 2, true)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Supply APY</p><p className="text-sm font-semibold">{liquidityInfo?.supplyAPY ? `${liquidityInfo.supplyAPY}%` : "N/A"}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Max Supply APY</p><p className="text-sm font-semibold">{liquidityInfo?.maxSupplyAPY ? `${liquidityInfo.maxSupplyAPY}%` : "N/A"}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Borrow APY</p><p className="text-sm font-semibold">{liquidityInfo?.borrowAPY ? `${liquidityInfo.borrowAPY}%` : "N/A"}</p></div>
                      {isLoggedIn && (
                        <div className="rounded-lg border border-border/60 p-3">
                          <p className="text-xs text-muted-foreground">Your {liquidityInfo?.withdrawable?._name || "lendUSDST"} (Total)</p>
                          <p className="text-sm font-semibold">{loadingLiquidity ? "Loading..." : formatBalance(liquidityInfo?.withdrawable?.userBalance || 0n, undefined, 18, 2, 2)}</p>
                        </div>
                      )}
                      <div className="rounded-lg border border-border/60 p-3 sm:col-span-2 xl:col-span-1">
                        <p className="text-xs text-muted-foreground">Conversion Rate</p>
                        <p className="text-sm font-semibold break-all">{liquidityInfo?.exchangeRate ? `1 ${liquidityInfo?.withdrawable?._name || "lendUSDST"} = ${formatUnits(liquidityInfo.exchangeRate, 18)} USDST` : "N/A"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default EarnLending;
