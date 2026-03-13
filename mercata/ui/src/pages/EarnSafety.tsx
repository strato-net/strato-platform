import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { ArrowLeft, CircleArrowDown, CircleArrowUp, Clock, HelpCircle, Shield } from "lucide-react";
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
import { useSafetyContext } from "@/context/SafetyContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useToast } from "@/hooks/use-toast";
import { SAFETY_STAKE_FEE, SAFETY_REDEEM_FEE, usdstAddress, safetyModuleAddress, rewardsEnabled } from "@/lib/constants";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

const EarnSafety = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const guestMode = !isLoggedIn;
  const { loading: tokensLoading, fetchTokens } = useUserTokens();
  const { fetchUsdstBalance, usdstBalance, approveToken } = useTokenContext();
  const {
    safetyInfo,
    loading,
    refreshSafetyInfo,
    stakeSafety,
    startCooldown,
    redeemSafety,
    redeemAllSafety,
  } = useSafetyContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  const [stakeAmount, setStakeAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [stakeSUSDST, setStakeSUSDST] = useState<boolean>(rewardsEnabled);
  const [includeStakedSUSDST, setIncludeStakedSUSDST] = useState<boolean>(false);

  const refreshData = (signal?: AbortSignal) => {
    refreshSafetyInfo(signal);
    if (isLoggedIn) {
      fetchTokens(signal);
      fetchUsdstBalance();
    }
  };

  useEffect(() => {
    document.title = "STRATO Earn Safety | STRATO";
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    refreshData(abortController.signal);
    return () => abortController.abort();
  }, []);

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
      const availableSharesWei = includeStakedSUSDST
        ? BigInt(safetyInfo?.userSharesTotal || "0")
        : BigInt(safetyInfo?.userShares || "0");
      const usdstBalanceWei = BigInt(usdstBalance);
      const feeWei = safeParseUnits(SAFETY_REDEEM_FEE, 18);
      if (amountWei <= 0n) return false;
      if (amountWei > availableSharesWei) return false;
      if (usdstBalanceWei < feeWei) return false;
      return true;
    } catch {
      return false;
    }
  };

  const handleStakeAction = async () => {
    try {
      setIsProcessing(true);
      const amountWei = safeParseUnits(stakeAmount, 18).toString();
      toast({
        title: "Approving USDST...",
        description: "Please approve the SafetyModule to spend your USDST tokens.",
      });
      await approveToken({ address: usdstAddress, spender: safetyModuleAddress, value: amountWei });
      await stakeSafety({ amount: amountWei, stakeSToken: rewardsEnabled && stakeSUSDST });
      toast({
        title: stakeSUSDST ? "Rewards Staking Successful" : "Stake Successful",
        description: stakeSUSDST
          ? `Successfully deposited ${stakeAmount} USDST and staked sUSDST to rewards program.`
          : `You have successfully staked ${stakeAmount} USDST for safetyUSDST.`,
        variant: "success",
      });
      setStakeAmount("");
      refreshData();
    } catch {
      // Error toast is handled globally.
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
        description: "Your unstaking cooldown period has started.",
        variant: "success",
      });
      refreshData();
    } catch {
      // Error toast is handled globally.
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
        await redeemSafety({ sharesAmount: sharesAmountWei, includeStakedSToken: includeStakedSUSDST });
      }
      toast({
        title: "Redeem Successful",
        description: "You have successfully redeemed safetyUSDST for USDST.",
        variant: "success",
      });
      setRedeemAmount("");
      refreshData();
    } catch {
      // Error toast is handled globally.
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTimeRemaining = (seconds?: string): string => {
    if (!seconds) return "N/A";
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "Completed";
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
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="Safety Module" />

        <main className="pb-16 md:pb-6 p-4 md:p-6">
          {guestMode && (
            <GuestSignInBanner message="Sign in to stake or redeem in the safety module" />
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
            <Card className="border border-border/70 bg-gradient-to-br from-emerald-500/10 via-background to-background">
              <CardContent className="pt-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Protection Layer</p>
                    <h1 className="text-2xl md:text-3xl font-semibold mt-1">USDST Safety Module</h1>
                    <p className="text-sm text-muted-foreground mt-1">Stake USDST, enter cooldown, then redeem safely.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">Total Staked</p>
                      <p className="text-sm font-semibold">{loading ? "Loading..." : formatBalance(safetyInfo?.totalAssets || 0n, undefined, 18, 2, 2, true)}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">Exchange Rate</p>
                      <p className="text-sm font-semibold break-all leading-tight">
                        {safetyInfo?.exchangeRate ? `${formatUnits(safetyInfo.exchangeRate, 18)}` : "1.0"}
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
                      <p className="text-base font-semibold">Stake</p>
                      <span className="text-xs text-muted-foreground">USDST to safetyUSDST</span>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={stakeAmount}
                          onChange={(e) => setStakeAmount(e.target.value)}
                          className={`pl-16 h-11 ${!isStakeAmountValid() && stakeAmount ? "text-red-600" : ""}`}
                          disabled={!isLoggedIn}
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">USDST</span>
                      </div>
                      <Button
                        onClick={handleStakeAction}
                        className="h-11 sm:w-36"
                        disabled={tokensLoading || isProcessing || !isStakeAmountValid() || !isLoggedIn}
                      >
                        {isProcessing ? "Processing..." : <><CircleArrowDown className="mr-2 h-4 w-4" />Stake</>}
                      </Button>
                    </div>

                    {isLoggedIn && (
                      <>
                        <div className="text-sm text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => {
                              const availableWei = BigInt(usdstBalance);
                              const feeWei = safeParseUnits(SAFETY_STAKE_FEE, 18);
                              const maxStakeableWei = availableWei > feeWei ? availableWei - feeWei : 0n;
                              const formatted = formatUnits(maxStakeableWei, 18);
                              const [whole, frac = ""] = formatted.split(".");
                              setStakeAmount(`${whole}.${frac.slice(0, 18)}`);
                            }}
                            className="text-blue-600 hover:underline mr-2"
                          >
                            Max
                          </button>
                          Available: {tokensLoading ? "Loading..." : formatBalance(usdstBalance || 0n, undefined, 18, 2)} USDST
                        </div>
                        <div className="text-sm text-muted-foreground">Transaction Fee: {SAFETY_STAKE_FEE} USDST</div>
                      </>
                    )}

                    <RewardsWidget userRewards={userRewards} activityName="Safety Module" inputAmount={stakeAmount} actionLabel="Stake" />

                    {rewardsEnabled && (
                      <div className="flex items-center space-x-2">
                        <Checkbox id="stake-susdst-earn" checked={stakeSUSDST} onCheckedChange={(checked) => setStakeSUSDST(checked as boolean)} />
                        <label htmlFor="stake-susdst-earn" className="text-sm font-medium">Stake my sUSDST to earn rewards</label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs text-sm">Automatically stake received sUSDST in rewards.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {safetyInfo?.userSharesTotal && BigInt(safetyInfo.userSharesTotal || "0") > 0n && (
                  <Card className="border border-border/70">
                    <CardContent className="pt-5 space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-500" />
                        <p className="text-base font-semibold">Cooldown</p>
                      </div>

                      {!safetyInfo?.cooldownActive ? (
                        <div className="rounded-lg border border-border/60 p-3">
                          <p className="text-sm text-muted-foreground mb-3">Start cooldown before redeeming.</p>
                          <Button onClick={handleStartCooldown} variant="outline" disabled={isProcessing} className="w-full sm:w-auto">
                            {isProcessing ? "Processing..." : "Start Cooldown"}
                          </Button>
                        </div>
                      ) : safetyInfo?.cooldownTimeRemaining && safetyInfo.cooldownTimeRemaining !== "0" ? (
                        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                          <p className="font-medium">Cooldown Active</p>
                          <p className="text-muted-foreground mt-1">Time remaining: {formatTimeRemaining(safetyInfo.cooldownTimeRemaining)}</p>
                        </div>
                      ) : safetyInfo?.unstakeWindowTimeRemaining && safetyInfo.unstakeWindowTimeRemaining !== "0" ? (
                        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">
                          <p className="font-medium">Unstake Window Open</p>
                          <p className="text-muted-foreground mt-1">Window closes in: {formatTimeRemaining(safetyInfo.unstakeWindowTimeRemaining)}</p>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                          <p className="font-medium">Unstake Window Closed</p>
                          <p className="text-muted-foreground mt-1 mb-2">Start a new cooldown to redeem.</p>
                          <Button onClick={handleStartCooldown} variant="outline" disabled={isProcessing} className="w-full sm:w-auto">
                            {isProcessing ? "Processing..." : "Restart Cooldown"}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card className="border border-border/70">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold">Redeem</p>
                      <span className="text-xs text-muted-foreground">safetyUSDST to USDST</span>
                    </div>

                    {safetyInfo && (!safetyInfo.userSharesTotal || BigInt(safetyInfo.userSharesTotal || "0") === 0n) ? (
                      <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
                        No safetyUSDST shares to redeem.
                      </div>
                    ) : !safetyInfo?.canRedeem ? (
                      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                        {!safetyInfo?.cooldownActive
                          ? "Start cooldown period before redeeming."
                          : safetyInfo?.cooldownTimeRemaining && safetyInfo.cooldownTimeRemaining !== "0"
                            ? "Cooldown in progress. Redeem after completion."
                            : "Unstake window expired. Start a new cooldown."}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm">Unstake window is open. You can redeem now.</div>
                    )}

                    {safetyInfo?.userSharesTotal && BigInt(safetyInfo.userSharesTotal || "0") > 0n && (
                      <>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <div className="relative flex-1">
                            <Input
                              type="number"
                              placeholder="0.00"
                              value={redeemAmount}
                              onChange={(e) => setRedeemAmount(e.target.value)}
                              className={`pl-24 h-11 ${!isRedeemAmountValid() && redeemAmount ? "text-red-600" : ""}`}
                              disabled={!safetyInfo?.canRedeem || (includeStakedSUSDST ? BigInt(safetyInfo.userSharesTotal || "0") === 0n : BigInt(safetyInfo.userShares || "0") === 0n)}
                            />
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">safetyUSDST</span>
                          </div>
                          <Button
                            onClick={() => handleRedeemAction("redeem")}
                            variant="outline"
                            className="h-11 sm:w-36"
                            disabled={loading || isProcessing || !isRedeemAmountValid() || !safetyInfo?.canRedeem}
                          >
                            {isProcessing ? "Processing..." : <><CircleArrowUp className="mr-2 h-4 w-4" />Redeem</>}
                          </Button>
                        </div>

                        <div className="text-sm text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => {
                              const availableShares = includeStakedSUSDST
                                ? BigInt(safetyInfo?.userSharesTotal || "0")
                                : BigInt(safetyInfo?.userShares || "0");
                              if (availableShares <= 0n) return;
                              const formatted = formatUnits(availableShares, 18);
                              const [w, f = ""] = formatted.split(".");
                              const clamped = f.length > 18 ? `${w}.${f.slice(0, 18)}` : formatted;
                              setRedeemAmount(clamped.replace(/\.?0+$/, ""));
                            }}
                            className="text-blue-600 hover:underline mr-2"
                          >
                            Max
                          </button>
                          Available: {loading ? "Loading..." : includeStakedSUSDST ? formatBalance(safetyInfo?.userSharesTotal || 0n, undefined, 18, 2) : formatBalance(safetyInfo?.userShares || 0n, undefined, 18, 2)} safetyUSDST
                        </div>

                        <div className="text-sm text-muted-foreground">Transaction Fee: {SAFETY_REDEEM_FEE} USDST</div>

                        {rewardsEnabled && (
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="include-staked-susdst-earn"
                              checked={includeStakedSUSDST}
                              onCheckedChange={(checked) => setIncludeStakedSUSDST(checked as boolean)}
                            />
                            <label htmlFor="include-staked-susdst-earn" className="text-sm font-medium">Include staked sUSDST</label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs text-sm">Redeem both staked and unstaked sUSDST.</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="xl:col-span-2">
                <Card className="border border-border/70 h-full">
                  <CardContent className="pt-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Shield className="h-4 w-4 text-emerald-600" />
                      <p className="text-base font-semibold">Safety Stats</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5">
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Total USDST Staked</p><p className="text-sm font-semibold">{loading ? "Loading..." : formatBalance(safetyInfo?.totalAssets || 0n, undefined, 18, 2, 2, true)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Total safetyUSDST Shares</p><p className="text-sm font-semibold">{loading ? "Loading..." : formatBalance(safetyInfo?.totalShares || 0n, undefined, 18, 2, 2)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Exchange Rate</p><p className="text-sm font-semibold break-all leading-tight">{loading ? "Loading..." : safetyInfo?.exchangeRate ? `1 safetyUSDST ≈ ${formatUnits(safetyInfo.exchangeRate, 18)} USDST` : "1 safetyUSDST = 1 USDST"}</p></div>
                      {isLoggedIn && <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Your safetyUSDST (Total)</p><p className="text-sm font-semibold">{loading ? "Loading..." : formatBalance(safetyInfo?.userSharesTotal || 0n, undefined, 18, 2, 2)}</p></div>}
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Cooldown Period</p><p className="text-sm font-semibold">{formatTimeRemaining(safetyInfo?.cooldownSeconds)}</p></div>
                      <div className="rounded-lg border border-border/60 p-3"><p className="text-xs text-muted-foreground">Unstake Window</p><p className="text-sm font-semibold">{formatTimeRemaining(safetyInfo?.unstakeWindow)}</p></div>
                      {isLoggedIn && safetyInfo?.cooldownActive && (
                        <div className="rounded-lg border border-border/60 p-3 sm:col-span-2 xl:col-span-1">
                          <p className="text-xs text-muted-foreground">Cooldown Status</p>
                          <p className="text-sm font-semibold">
                            {safetyInfo?.cooldownTimeRemaining && safetyInfo.cooldownTimeRemaining !== "0" ? (
                              <span className="text-yellow-600">{formatTimeRemaining(safetyInfo.cooldownTimeRemaining)} remaining</span>
                            ) : safetyInfo?.unstakeWindowTimeRemaining && safetyInfo.unstakeWindowTimeRemaining !== "0" ? (
                              <span className="text-green-600">Window open ({formatTimeRemaining(safetyInfo.unstakeWindowTimeRemaining)} left)</span>
                            ) : (
                              <span className="text-red-600">Window closed</span>
                            )}
                          </p>
                        </div>
                      )}
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

export default EarnSafety;
