import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft, CheckCircle2, Clock, RefreshCw, Search } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type StakingActionMode = "stake" | "claim" | "unstake";

type StakingInfo = {
  configured: boolean;
  deployed: boolean;
  stakingAddress: string;
  validatorRegistryAddress: string;
  stratoTokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: string;
  walletBalance: string;
  totalUserStake: string;
  totalSelfBond: string;
  totalUnbonding: string;
  totalRewardableStake: string;
  activeValidatorCount: string;
  rewardReserve: string;
  baseRewardBps: string;
  maxCommissionBps: string;
  maxBatchSize: string;
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

const formatAmountInput = (value: bigint, decimals: number): string => {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
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

const validatorKey = (validator: StakingValidator): string => validator.operator || validator.address;

const EarnStaking = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { toast } = useToast();
  const [info, setInfo] = useState<StakingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [actionMode, setActionMode] = useState<StakingActionMode | null>(null);
  const [actionOperator, setActionOperator] = useState("");

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

  const walletBalance = useMemo(() => BigInt(info?.walletBalance || "0"), [info?.walletBalance]);
  const totalStakeAmount = useMemo(() => safeParseUnits(stakeAmount, decimals), [decimals, stakeAmount]);

  const filteredValidators = useMemo(() => {
    const query = validatorSearch.trim().toLowerCase();
    if (!query) return validators;

    return validators.filter((validator) => {
      const operator = validatorKey(validator);
      return [
        validator.name,
        validator.description,
        validator.protocolValidatorId,
        operator,
      ].some((value) => (value || "").toLowerCase().includes(query));
    });
  }, [validatorSearch, validators]);

  const actionValidator = useMemo(
    () => validators.find((validator) => validatorKey(validator) === actionOperator),
    [actionOperator, validators]
  );

  const actionValidatorOperator = actionValidator ? validatorKey(actionValidator) : "";
  const actionValidatorLabel = actionValidator
    ? actionValidator.name || actionValidator.protocolValidatorId || truncateAddress(actionValidatorOperator, 8, 6)
    : "";
  const actionValidatorStake = BigInt(actionValidator?.userStake || "0");
  const actionValidatorRewards = BigInt(actionValidator?.pendingRewards || "0");
  const unstakeAmountParsed = useMemo(() => safeParseUnits(unstakeAmount, decimals), [decimals, unstakeAmount]);
  const stakeReady =
    isLoggedIn &&
    !!actionValidator?.active &&
    totalStakeAmount > 0n &&
    totalStakeAmount <= walletBalance;
  const claimReady =
    isLoggedIn &&
    !!actionValidator &&
    actionValidatorRewards > 0n;
  const unstakeReady =
    isLoggedIn &&
    !!actionValidator &&
    actionValidatorStake > 0n &&
    unstakeAmountParsed > 0n &&
    unstakeAmountParsed <= actionValidatorStake;

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
    } catch (error: unknown) {
      const failure = error as { response?: { data?: { error?: string } }; message?: string };
      toast({
        title: "Transaction failed",
        description: failure.response?.data?.error || failure.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openActionModal = (validator: StakingValidator, mode: StakingActionMode) => {
    setActionOperator(validatorKey(validator));
    setActionMode(mode);
    setStakeAmount("");
    setUnstakeAmount("");
  };

  const closeActionModal = () => {
    setActionMode(null);
    setActionOperator("");
    setStakeAmount("");
    setUnstakeAmount("");
  };

  const handleStake = async () => {
    if (!stakeReady || !actionValidatorOperator) return;
    await runAction(
      async () => {
        await api.post("/staking/stake", {
          delegations: [{ operator: actionValidatorOperator, amount: totalStakeAmount.toString() }],
        });
        closeActionModal();
        setStakeAmount("");
      },
      "Stake submitted"
    );
  };

  const handleUnstake = async () => {
    if (!unstakeReady || !actionValidatorOperator) return;

    await runAction(
      async () => {
        await api.post("/staking/unstake", { operator: actionValidatorOperator, amount: unstakeAmountParsed.toString() });
        closeActionModal();
        setUnstakeAmount("");
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

  const handleModalClaim = async () => {
    if (!claimReady || !actionValidatorOperator) return;
    await runAction(
      async () => {
        await api.post("/staking/claim", { operators: [actionValidatorOperator] });
        closeActionModal();
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

  const setMaxStakeAmount = () => {
    if (!info) return;
    setStakeAmount(formatAmountInput(BigInt(info.walletBalance || "0"), decimals));
  };

  const setMaxUnstakeAmount = () => {
    setUnstakeAmount(formatAmountInput(actionValidatorStake, decimals));
  };

  const pageContent = () => {
    if (loading && !info) {
      return (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading staking...</CardContent>
        </Card>
      );
    }

    if (!info) {
      return (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No staking data.</CardContent>
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Validators</h2>
                <p className="text-sm text-muted-foreground">
                  {info.activeValidatorCount} active · unbonding {formatDuration(info.unbondingSeconds)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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

            <div className="mt-5">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative sm:w-80">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={validatorSearch}
                    onChange={(event) => setValidatorSearch(event.target.value)}
                    placeholder="Search validators"
                    className="pl-9"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredValidators.length} of {validators.length}
                </p>
              </div>

              <div className="max-h-[34rem] overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[1180px]">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Validator</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Total Stake</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Your Stake</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Rewards</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Est. APY</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Commission %</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredValidators.map((validator) => {
                      const operator = validatorKey(validator);
                      const label = validator.name || validator.protocolValidatorId || truncateAddress(operator, 8, 6);
                      const userStake = BigInt(validator.userStake || "0");
                      const pendingRewards = BigInt(validator.pendingRewards || "0");

                      return (
                        <tr key={operator} className="border-b border-border/50 last:border-b-0 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <div className="min-w-0">
                              <p className="font-medium">{label}</p>
                              {validator.description && (
                                <p className="mt-0.5 max-w-[28rem] truncate text-xs text-muted-foreground">{validator.description}</p>
                              )}
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {validator.protocolValidatorId || truncateAddress(operator, 8, 6)}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-sm">{formatToken(validator.totalStake, decimals)} {symbol}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatToken(validator.userStake, decimals)} {symbol}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatToken(validator.pendingRewards, decimals)} {symbol}</td>
                          <td className="px-4 py-3 text-right text-sm">{validator.estimatedApy === "-" ? "-" : `${validator.estimatedApy}%`}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatPercentFromBps(validator.commissionBps)}</td>
                          <td className="px-4 py-3 text-sm">
                            <Badge variant={validator.active ? "secondary" : "outline"}>
                              {validator.active ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                onClick={() => openActionModal(validator, "stake")}
                                disabled={!isLoggedIn || !validator.active || submitting}
                              >
                                Stake
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openActionModal(validator, "claim")}
                                disabled={!isLoggedIn || pendingRewards <= 0n || submitting}
                              >
                                Claim
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openActionModal(validator, "unstake")}
                                disabled={!isLoggedIn || userStake <= 0n || submitting}
                              >
                                Unstake
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredValidators.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={8}>
                          No validators.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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

        <main className="mx-auto max-w-7xl px-4 py-6">
          <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/dashboard/earn")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Earn
          </Button>

          {pageContent()}

          <Dialog open={!!actionMode} onOpenChange={(open) => (!open ? closeActionModal() : undefined)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {actionMode === "stake" && "Stake STRATO"}
                  {actionMode === "claim" && "Claim Rewards"}
                  {actionMode === "unstake" && "Unstake STRATO"}
                </DialogTitle>
                <DialogDescription>
                  {actionValidatorLabel || "Validator action"}
                </DialogDescription>
              </DialogHeader>

              {actionValidator && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="font-medium">{actionValidatorLabel}</p>
                    {actionValidator.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{actionValidator.description}</p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {actionValidator.protocolValidatorId || truncateAddress(actionValidatorOperator, 8, 6)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Est. APY</p>
                      <p className="font-semibold">{actionValidator.estimatedApy === "-" ? "-" : `${actionValidator.estimatedApy}%`}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Commission</p>
                      <p className="font-semibold">{formatPercentFromBps(actionValidator.commissionBps)}</p>
                    </div>
                  </div>

                  {actionMode === "stake" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-medium">Amount</label>
                        <button
                          type="button"
                          className="text-xs font-medium text-primary disabled:text-muted-foreground"
                          onClick={setMaxStakeAmount}
                          disabled={!isLoggedIn || walletBalance <= 0n || !actionValidator.active}
                        >
                          Max
                        </button>
                      </div>
                      <Input
                        value={stakeAmount}
                        onChange={(event) => setStakeAmount(event.target.value)}
                        placeholder={`0 ${symbol}`}
                        inputMode="decimal"
                        disabled={!isLoggedIn || !actionValidator.active}
                      />
                      <p className="text-xs text-muted-foreground">
                        Wallet: {formatToken(info?.walletBalance, decimals)} {symbol}
                      </p>
                    </div>
                  )}

                  {actionMode === "claim" && (
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                      <p className="text-xs text-muted-foreground">Claimable</p>
                      <p className="font-semibold">{formatToken(actionValidator.pendingRewards, decimals)} {symbol}</p>
                    </div>
                  )}

                  {actionMode === "unstake" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-medium">Amount</label>
                        <button
                          type="button"
                          className="text-xs font-medium text-primary disabled:text-muted-foreground"
                          onClick={setMaxUnstakeAmount}
                          disabled={!isLoggedIn || actionValidatorStake <= 0n}
                        >
                          Max
                        </button>
                      </div>
                      <Input
                        value={unstakeAmount}
                        onChange={(event) => setUnstakeAmount(event.target.value)}
                        placeholder={`0 ${symbol}`}
                        inputMode="decimal"
                        disabled={!isLoggedIn || actionValidatorStake <= 0n}
                      />
                      <p className="text-xs text-muted-foreground">
                        Your stake: {formatToken(actionValidator.userStake, decimals)} {symbol} · unbonding {formatDuration(info?.unbondingSeconds)}
                      </p>
                    </div>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={closeActionModal} disabled={submitting}>
                      Cancel
                    </Button>
                    {actionMode === "stake" && (
                      <Button onClick={handleStake} disabled={!stakeReady || submitting}>
                        Stake
                      </Button>
                    )}
                    {actionMode === "claim" && (
                      <Button onClick={handleModalClaim} disabled={!claimReady || submitting}>
                        Claim
                      </Button>
                    )}
                    {actionMode === "unstake" && (
                      <Button onClick={handleUnstake} disabled={!unstakeReady || submitting}>
                        Unstake
                      </Button>
                    )}
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default EarnStaking;
