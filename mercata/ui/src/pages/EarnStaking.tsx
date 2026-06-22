import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft, CheckCircle2, Clock, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { safeParseUnits, truncateAddress } from "@/utils/numberUtils";

type StakingValidator = {
  address: string;
  operator: string;
  name: string;
  description: string;
  protocolValidatorId: string;
  active: boolean;
  commissionBps: string;
  selfBond: string;
  delegatedStake: string;
  totalStake: string;
  estimatedApy: string;
  userStake: string;
  pendingRewards: string;
};

type UnbondingRequest = {
  id: string;
  amount: string;
  releaseTime: string;
  claimed: boolean;
  ready: boolean;
};

type StakingInfo = {
  configured: boolean;
  deployed: boolean;
  stakingAddress: string;
  stratoTokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: string;
  walletBalance: string;
  totalUserStake: string;
  totalSelfBond: string;
  totalRewardableStake: string;
  activeValidatorCount: string;
  rewardReserve: string;
  unbondingSeconds: string;
  periodStart: string;
  periodFinish: string;
  rewardPeriodName: string;
  rewardPeriodDescription: string;
  estimatedApy: string;
  userTotalStake: string;
  claimableRewards: string;
  validators: StakingValidator[];
  unbondingRequests: UnbondingRequest[];
};

const formatToken = (value: string | undefined, decimals: number, maxFractionDigits = 4): string => {
  try {
    const amount = Number(formatUnits(value || "0", decimals));
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.000001) return "0";
    return amount.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
  } catch {
    return "0";
  }
};

const formatPercentFromBps = (value: string | undefined): string => {
  const bps = Number(value || "0");
  if (!Number.isFinite(bps)) return "0.00%";
  return `${(bps / 100).toFixed(2)}%`;
};

const formatDuration = (seconds: string | undefined): string => {
  const raw = Number(seconds || "0");
  if (!Number.isFinite(raw) || raw <= 0) return "0 days";
  const days = raw / 86400;
  if (days >= 1) return `${days.toFixed(days >= 10 ? 0 : 1)} days`;
  const hours = raw / 3600;
  return `${hours.toFixed(hours >= 10 ? 0 : 1)} hours`;
};

const formatReleaseTime = (releaseTime: string): string => {
  const ts = Number(releaseTime || "0");
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  return new Date(ts * 1000).toLocaleString();
};

const formatRewardPeriodStatus = (startTime: string | undefined, finishTime: string | undefined): string => {
  const start = Number(startTime || "0");
  const finish = Number(finishTime || "0");
  const now = Date.now() / 1000;

  if (!Number.isFinite(finish) || finish <= 0) return "No period scheduled";
  if (Number.isFinite(start) && now < start) return `Starts ${formatReleaseTime(startTime || "0")}`;
  if (now < finish) return `Active until ${formatReleaseTime(finishTime || "0")}`;
  return `Ended ${formatReleaseTime(finishTime || "0")}`;
};

const EarnStaking = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const [info, setInfo] = useState<StakingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stakeAmounts, setStakeAmounts] = useState<Record<string, string>>({});
  const [unstakeAmounts, setUnstakeAmounts] = useState<Record<string, string>>({});

  const decimals = Number(info?.tokenDecimals || 18);
  const symbol = info?.tokenSymbol || "STRATO";

  const refreshInfo = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = isLoggedIn ? "/staking/info" : "/staking/info/public";
      const { data } = await api.get<StakingInfo>(endpoint);
      setInfo(data);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    document.title = "Stake STRATO | STRATO";
    window.scrollTo(0, 0);
    refreshInfo();
  }, [refreshInfo]);

  const validators = useMemo(
    () => info?.validators || [],
    [info?.validators]
  );

  const activeValidators = useMemo(
    () => validators.filter((validator) => validator.active),
    [validators]
  );

  const activeOperatorSet = useMemo(
    () => new Set(activeValidators.map((validator) => validator.operator || validator.address)),
    [activeValidators]
  );

  const userValidators = useMemo(
    () => validators.filter((validator) => BigInt(validator.userStake || "0") > 0n || BigInt(validator.pendingRewards || "0") > 0n),
    [validators]
  );

  const stakeDelegations = useMemo(() => {
    return Object.entries(stakeAmounts)
      .map(([operator, amount]) => ({
        operator,
        amount: safeParseUnits(amount, decimals).toString(),
      }))
      .filter((delegation) => activeOperatorSet.has(delegation.operator) && BigInt(delegation.amount) > 0n);
  }, [activeOperatorSet, decimals, stakeAmounts]);

  const totalStakeAmount = useMemo(
    () => stakeDelegations.reduce((sum, delegation) => sum + BigInt(delegation.amount), 0n),
    [stakeDelegations]
  );

  const readyUnbondingRequests = useMemo(
    () => (info?.unbondingRequests || []).filter((request) => request.ready && !request.claimed),
    [info?.unbondingRequests]
  );

  const runAction = async (action: () => Promise<void>, successTitle: string) => {
    try {
      setSubmitting(true);
      await action();
      toast({ title: successTitle, variant: "success" });
      await refreshInfo();
    } catch (error: any) {
      toast({
        title: "Transaction failed",
        description: error?.response?.data?.error || error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStake = async () => {
    if (!stakeDelegations.length) return;
    await runAction(
      async () => {
        await api.post("/staking/stake", { delegations: stakeDelegations });
        setStakeAmounts({});
      },
      "Stake submitted"
    );
  };

  const handleUnstake = async (operator: string) => {
    const amount = safeParseUnits(unstakeAmounts[operator] || "", decimals).toString();
    if (BigInt(amount) <= 0n) return;

    await runAction(
      async () => {
        await api.post("/staking/unstake", { operator, amount });
        setUnstakeAmounts((prev) => ({ ...prev, [operator]: "" }));
      },
      "Unstake submitted"
    );
  };

  const handleClaim = async (operator?: string) => {
    await runAction(
      async () => {
        await api.post("/staking/claim", operator ? { operators: [operator] } : { claimAll: true });
      },
      "Claim submitted"
    );
  };

  const handleWithdrawReady = async () => {
    await runAction(
      async () => {
        await api.post("/staking/withdraw-unbonded", { withdrawAll: true });
      },
      "Withdrawal submitted"
    );
  };

  const setMaxStakeForFirstValidator = () => {
    const firstOperator = activeValidators[0]?.operator || activeValidators[0]?.address;
    if (!firstOperator || !info) return;
    setStakeAmounts({ [firstOperator]: formatUnits(info.walletBalance || "0", decimals) });
  };

  const pageContent = () => {
    if (loading && !info) {
      return (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading staking...</CardContent>
        </Card>
      );
    }

    if (!info?.configured || !info?.deployed) {
      return (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <h2 className="text-base font-semibold">Stake STRATO</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  STRATO staking is not deployed on this network yet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Estimated APY</p>
              <p className="mt-1 text-2xl font-semibold">{info.estimatedApy === "-" ? "-" : `${info.estimatedApy}%`}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Wallet</p>
              <p className="mt-1 text-2xl font-semibold">{formatToken(info.walletBalance, decimals)} {symbol}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Staked</p>
              <p className="mt-1 text-2xl font-semibold">{formatToken(info.userTotalStake, decimals)} {symbol}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Claimable</p>
              <p className="mt-1 text-2xl font-semibold">{formatToken(info.claimableRewards, decimals)} {symbol}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Reward Period</p>
            <p className="mt-1 text-lg font-semibold">{info.rewardPeriodName || "STRATO staking rewards"}</p>
            {info.rewardPeriodDescription && (
              <p className="mt-1 text-sm text-muted-foreground">{info.rewardPeriodDescription}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {formatRewardPeriodStatus(info.periodStart, info.periodFinish)}
            </p>
          </CardContent>
        </Card>

        {!isLoggedIn && <GuestSignInBanner message="Connect your wallet to stake STRATO." />}

        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Validators</h2>
                <p className="text-sm text-muted-foreground">
                  {info.activeValidatorCount} active · unbonding {formatDuration(info.unbondingSeconds)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={refreshInfo} disabled={loading || submitting}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleClaim()}
                  disabled={!isLoggedIn || submitting || BigInt(info.claimableRewards || "0") <= 0n}
                >
                  Claim All
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {validators.map((validator) => {
                const operator = validator.operator || validator.address;
                const label = validator.name || validator.protocolValidatorId || truncateAddress(operator, 8, 6);

                return (
                  <div key={operator} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{label}</p>
                          <Badge variant={validator.active ? "secondary" : "outline"}>
                            {validator.active ? "Active" : "Inactive"}
                          </Badge>
                          <Badge variant="secondary">Commission {formatPercentFromBps(validator.commissionBps)}</Badge>
                        </div>
                        {validator.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{validator.description}</p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>APY {validator.estimatedApy}%</span>
                          <span>Total {formatToken(validator.totalStake, decimals)} {symbol}</span>
                          <span>Mine {formatToken(validator.userStake, decimals)} {symbol}</span>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_auto]">
                        <Input
                          value={stakeAmounts[operator] || ""}
                          onChange={(event) => setStakeAmounts((prev) => ({ ...prev, [operator]: event.target.value }))}
                          placeholder={`Stake ${symbol}`}
                          inputMode="decimal"
                          disabled={!validator.active}
                        />
                        <Button
                          variant="outline"
                          onClick={() => handleClaim(operator)}
                          disabled={!isLoggedIn || submitting || BigInt(validator.pendingRewards || "0") <= 0n}
                        >
                          Claim
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {validators.length === 0 && (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No validators.
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Total: {formatToken(totalStakeAmount.toString(), decimals)} {symbol}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={setMaxStakeForFirstValidator} disabled={!isLoggedIn || activeValidators.length === 0}>
                  Max
                </Button>
                <Button onClick={handleStake} disabled={!isLoggedIn || submitting || totalStakeAmount <= 0n}>
                  Stake STRATO
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">My Stake</h2>
            </div>

            <div className="mt-4 space-y-3">
              {userValidators.map((validator) => {
                const operator = validator.operator || validator.address;
                const label = validator.name || validator.protocolValidatorId || truncateAddress(operator, 8, 6);

                return (
                  <div key={operator} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatToken(validator.userStake, decimals)} {symbol} staked · {formatToken(validator.pendingRewards, decimals)} {symbol} rewards
                        </p>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_auto]">
                        <Input
                          value={unstakeAmounts[operator] || ""}
                          onChange={(event) => setUnstakeAmounts((prev) => ({ ...prev, [operator]: event.target.value }))}
                          placeholder={`Unstake ${symbol}`}
                          inputMode="decimal"
                        />
                        <Button
                          variant="outline"
                          onClick={() => handleUnstake(operator)}
                          disabled={!isLoggedIn || submitting || safeParseUnits(unstakeAmounts[operator] || "", decimals) <= 0n}
                        >
                          Unstake
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {userValidators.length === 0 && (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No staked STRATO.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Unbonding</h2>
              </div>
              <Button
                variant="outline"
                onClick={handleWithdrawReady}
                disabled={!isLoggedIn || submitting || readyUnbondingRequests.length === 0}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Withdraw Ready
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {(info.unbondingRequests || []).map((request) => (
                <div key={request.id} className="flex flex-col gap-1 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium">{formatToken(request.amount, decimals)} {symbol}</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{request.claimed ? "Withdrawn" : request.ready ? "Ready" : formatReleaseTime(request.releaseTime)}</span>
                    {request.ready && !request.claimed && <Badge variant="secondary">Ready</Badge>}
                  </div>
                </div>
              ))}

              {info.unbondingRequests.length === 0 && (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No unbonding requests.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="Stake STRATO" />

        <main className="mx-auto max-w-6xl px-4 py-6">
          <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/dashboard/earn")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Earn
          </Button>

          {pageContent()}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default EarnStaking;
