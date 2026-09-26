import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { useAccount } from "wagmi";
import { formatUnits } from "ethers";
import { ArrowLeft, CheckCircle2, Clock, Gift, Info, Layers, Loader2, RefreshCw, Search, Shield, TrendingUp, Trophy, Wallet, type LucideIcon } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/axios";
import STRATOICON from "@/assets/icon.png";
import STRATOICONDARK from "@/assets/dark-theme-strato-compressed-logo.png";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useEarnContext } from "@/context/EarnContext";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { EarnApyInfo } from "@/utils/earnUtils";
import { useToast } from "@/hooks/use-toast";
import { STAKING_STAKE_FEE, STAKING_ACTION_FEE } from "@/lib/constants";
import { safeParseUnits, truncateAddress, truncateDecimals } from "@/utils/numberUtils";
import ValidatorStatusBadge, { type ValidatorLifecycle } from "@/components/staking/ValidatorStatusBadge";
import BecomeValidatorCard, { type RegisterValidatorInput } from "@/components/staking/BecomeValidatorCard";

type StakingValidator = ValidatorLifecycle & {
  address: string;
  operator: string;
  name: string;
  description: string;
  protocolValidatorId: string;
  validatorAddress: string;
  active: boolean;
  isValidator: boolean;
  eligible: boolean;
  blocksProposed: string;
  missedProposals: string;
  consecutiveMisses: string;
  commissionBps: string;
  selfBond: string;
  delegatedStake: string;
  totalStake: string;
  estimatedApy: string;
  userStake: string;
  pendingRewards: string;
  pendingFees: string;
  metadataURI?: string;
  // V2 only: what this validator's operator can claim for it (STRATO rewards, USDST fees).
  operatorPendingRewards?: string;
  operatorPendingFees?: string;
};

type UnbondingRequest = {
  id: string;
  amount: string;
  releaseTime: string;
  claimed: boolean;
  ready: boolean;
};

type StakingActionMode = "stake" | "claim" | "unstake" | "move";

// Move stake is temporarily hidden from the UI; the modal flow and backend
// endpoint remain intact so it can be re-enabled by flipping this flag.
const SHOW_MOVE_BUTTON = false;

// Validators shown before the "Show all" toggle expands the list.
const VALIDATOR_DISPLAY_LIMIT = 10;
type ProcessingAction =
  | "stake" | "claim" | "unstake" | "move" | "withdraw" | "operator-claim" | "commission" | "bond" | "self-unbond"
  | "claim-fees" | "operator-claim-fees" | "register" | "activate" | "exit" | "cancel-exit" | "profile";

type StakingInfo = {
  configured: boolean;
  deployed: boolean;
  // False until the validator-set / proposer-fee staking upgrade is deployed on this
  // network: validator addresses, set membership and liveness counters do not exist
  // on chain yet, so the features built on them stay hidden rather than showing zeros.
  validatorSetDeployed: boolean;
  // "v2" = validator-keyed contract: rows keyed by validator address, block rewards and proposer
  // fees only. "v1" = operator-keyed contract with a funded reward schedule. Absent on older backends.
  contractVersion?: "v1" | "v2";
  // V2: minStake phases in as a self-bond requirement at this unix time ("0" = not scheduled);
  // until then delegated stake still counts toward eligibility.
  selfBondGraceUntil?: string;
  selfBondRuleActive?: boolean;
  totalRewardsCredited?: string;
  // V2: validator addresses the connected account operates.
  operatedValidators?: string[];
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
  // Reward schedule fields below are V1 only ("0"/"" on V2).
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
  minStake: string;
  proposerFeeBps: string;
  joinsPaused: boolean;
  validatorCount: string;
  maxActiveValidators: string;
  hardCapActiveValidators: string;
  exitNoticeSeconds: string;
  userTotalStake: string;
  claimableRewards: string;
  claimableFees: string;
  totalEarned: string;
  isOperator: boolean;
  operatorAddress: string;
  operatorStatus: 0 | 1 | 2 | 3;
  operatorClaimableRewards: string;
  operatorClaimableFees: string;
  operatorPendingBaseRewards: string;
  operatorPendingCommission: string;
  operatorPendingSelfBondRewards: string;
  currentOperatorCommissionBps: string;
  validators: StakingValidator[];
  unbondingRequests: UnbondingRequest[];
};

const formatToken = (value: string | undefined, decimals: number, maxFractionDigits = 4): string => {
  try {
    // Truncate (never round) so displayed amounts match the portfolio's formatBalance convention.
    const amount = Number(truncateDecimals(formatUnits(value || "0", decimals), maxFractionDigits));
    if (!Number.isFinite(amount) || amount === 0) return "0";
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

const parsePercentToBps = (value: string): bigint | null => {
  const raw = value.trim();
  if (!raw || !/^\d+(\.\d{0,2})?$/.test(raw)) return null;

  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
};

const recordFromUnknown = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;

const readableErrorMessage = (value: unknown): string | null => {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const record = recordFromUnknown(value);
  if (!record) return null;

  return readableErrorMessage(record.message) || readableErrorMessage(record.error);
};

const stakingActionErrorMessage = (error: unknown): string => {
  const failure = recordFromUnknown(error);
  const response = recordFromUnknown(failure?.response);
  const data = recordFromUnknown(response?.data);

  return readableErrorMessage(data?.error)
    || readableErrorMessage(data?.message)
    || readableErrorMessage(error)
    || "Please try again.";
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

// V2 phases minStake in as a self-bond requirement: delegated stake counts until the grace
// deadline ("0" = not yet scheduled), after which only self-bond does.
const selfBondRequirementText = (info: StakingInfo, minStakeLabel: string): string => {
  if (info.selfBondRuleActive) {
    return `Validators need ${minStakeLabel} of self-bond; delegated stake no longer counts toward it.`;
  }
  const grace = Number(info.selfBondGraceUntil || "0");
  if (Number.isFinite(grace) && grace > 0) {
    return `Validators need ${minStakeLabel} of self-bond. Delegated stake counts toward it until ${formatReleaseTime(info.selfBondGraceUntil || "0")}.`;
  }
  return `Validators need ${minStakeLabel} of self-bond. Delegated stake still counts toward it; the self-bond deadline is not yet scheduled.`;
};

const TipLabel = ({ label, tooltip, className }: { label: string; tooltip: string; className?: string }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 ${className || ""}`}>
          {label}
          <Info className="h-3 w-3 shrink-0 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem]">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const StatCard = ({ label, tooltip, value, icon: Icon }: { label: string; tooltip?: string; value: ReactNode; icon?: LucideIcon }) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        {tooltip ? <TipLabel label={label} tooltip={tooltip} /> : <span>{label}</span>}
      </div>
      <p className="mt-1 font-semibold">{value}</p>
    </CardContent>
  </Card>
);

// V2 keys every validator by its consensus address (one operator may run several);
// V1 keys validators by their operator.
const validatorKey = (validator: StakingValidator, isV2: boolean): string =>
  isV2 ? validator.address : validator.operator || validator.address;

const sameAddress = (left: string | undefined, right: string | undefined): boolean => {
  const normalized = (left || "").toLowerCase().replace(/^0x/, "");
  return normalized !== "" && normalized === (right || "").toLowerCase().replace(/^0x/, "");
};

type OperatorProfileInput = {
  name: string;
  description: string;
  metadataURI: string;
  protocolValidatorId: string;
};

type OperatorPanelProps = {
  isV2: boolean;
  validator: StakingValidator | undefined;
  claimableRewards: string;
  claimableFees: string;
  rewardBreakdown: string;
  currentCommissionBps: string;
  maxCommissionBps: string;
  walletBalance: string;
  minStake: string;
  decimals: number;
  symbol: string;
  selfBondNote?: string;
  selfBondRuleActive: boolean;
  validatorSetDeployed: boolean;
  canManage: boolean;
  joinsPaused: boolean;
  canCoverActionFee: boolean;
  submitting: boolean;
  // The in-flight action, when it belongs to this panel.
  processing: ProcessingAction | null;
  onClaim: () => Promise<boolean>;
  onClaimFees: () => Promise<boolean>;
  onCommission: (commissionBps: bigint) => Promise<boolean>;
  onSelfBond: (amount: bigint) => Promise<boolean>;
  onSelfUnbond: (amount: bigint) => Promise<boolean>;
  onActivate: () => Promise<boolean>;
  onRequestExit: () => Promise<boolean>;
  onCancelExit: () => Promise<boolean>;
  onUpdateProfile?: (profile: OperatorProfileInput) => Promise<boolean>;
};

// Operator controls for one validator. V1 renders a single panel for the caller's operator
// record; V2 renders one per validator the caller operates, each with its own inputs.
const OperatorPanel = ({
  isV2,
  validator,
  claimableRewards,
  claimableFees,
  rewardBreakdown,
  currentCommissionBps,
  maxCommissionBps,
  walletBalance,
  minStake,
  decimals,
  symbol,
  selfBondNote,
  selfBondRuleActive,
  validatorSetDeployed,
  canManage,
  joinsPaused,
  canCoverActionFee,
  submitting,
  processing,
  onClaim,
  onClaimFees,
  onCommission,
  onSelfBond,
  onSelfUnbond,
  onActivate,
  onRequestExit,
  onCancelExit,
  onUpdateProfile,
}: OperatorPanelProps) => {
  const [commissionPercent, setCommissionPercent] = useState("");
  const [selfBondAmount, setSelfBondAmount] = useState("");
  const [selfUnbondAmount, setSelfUnbondAmount] = useState("");
  const [profileDraft, setProfileDraft] = useState<OperatorProfileInput | null>(null);

  const active = Boolean(validator?.active);
  const inSet = Boolean(validator?.isValidator);
  const exiting = Number(validator?.exitReadyTime || "0") > 0;
  const canActivate = Boolean(validator?.isWaiter) && !joinsPaused;
  const claimable = BigInt(claimableRewards || "0");
  const fees = BigInt(claimableFees || "0");
  const selfBond = BigInt(validator?.selfBond || "0");
  const wallet = BigInt(walletBalance || "0");
  const commissionBps = parsePercentToBps(commissionPercent);
  const selfBondParsed = safeParseUnits(selfBondAmount, decimals);
  const selfUnbondParsed = safeParseUnits(selfUnbondAmount, decimals);
  const claimReady = canManage && claimable > 0n;
  const commissionReady = canManage && active && commissionBps !== null && commissionBps <= BigInt(maxCommissionBps || "0");
  const selfBondReady = canManage && active && selfBondParsed > 0n && selfBondParsed <= wallet;
  const selfUnbondReady = canManage && selfUnbondParsed > 0n && selfUnbondParsed <= selfBond;
  const belowSelfBond = isV2 && !!validator && selfBond < BigInt(minStake || "0");
  const validatorLabel = validator ? validator.name || truncateAddress(validator.address, 8, 6) : "";
  const activationStake = isV2 && selfBondRuleActive ? "self-bond" : "total stake";

  const buttonLabel = (action: ProcessingAction, label: string, pendingLabel: string) => (
    processing === action ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {pendingLabel}
      </>
    ) : label
  );

  const submitClaim = async () => {
    if (!claimReady) return;
    await onClaim();
  };

  const submitCommission = async () => {
    if (!commissionReady || commissionBps === null) return;
    if (await onCommission(commissionBps)) setCommissionPercent("");
  };

  const submitSelfBond = async () => {
    if (!selfBondReady) return;
    if (await onSelfBond(selfBondParsed)) setSelfBondAmount("");
  };

  const submitSelfUnbond = async () => {
    if (!selfUnbondReady) return;
    if (await onSelfUnbond(selfUnbondParsed)) setSelfUnbondAmount("");
  };

  const openProfile = () => {
    if (!validator) return;
    setProfileDraft({
      name: validator.name || "",
      description: validator.description || "",
      metadataURI: validator.metadataURI || "",
      protocolValidatorId: validator.protocolValidatorId || "",
    });
  };

  const updateProfileField = (field: keyof OperatorProfileInput) => (event: { target: { value: string } }) => {
    const value = event.target.value;
    setProfileDraft((draft) => (draft ? { ...draft, [field]: value } : draft));
  };

  const submitProfile = async () => {
    if (!profileDraft || !onUpdateProfile) return;
    if (await onUpdateProfile(profileDraft)) setProfileDraft(null);
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{isV2 && validator ? `Operator · ${validatorLabel}` : "Operator"}</h2>
            <p className="text-sm text-muted-foreground">
              {active
                ? "Claim validator rewards, update commission, or manage self-bond."
                : "Claim accrued validator rewards or unbond existing self-bond."}
            </p>
            {validator && validatorSetDeployed && (
              <p className="mt-1 text-xs text-muted-foreground">
                Validator {truncateAddress((isV2 ? validator.address : validator.validatorAddress) || "", 8, 6) || "not set"}
                {" · "}{validator.blocksProposed} blocks proposed · {validator.missedProposals} missed
                {inSet || !active ? "" : ` · needs ${formatToken(minStake, decimals, 0)} ${symbol} ${activationStake} to activate`}
              </p>
            )}
            {selfBondNote && (
              <p className={`mt-1 text-xs ${belowSelfBond ? "text-yellow-600" : "text-muted-foreground"}`}>
                {selfBondNote}
                {belowSelfBond ? ` This validator's self-bond is ${formatToken(validator?.selfBond, decimals)} ${symbol}.` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {validator && <ValidatorStatusBadge validator={validator} />}
            {canActivate && (
              <Button size="sm" onClick={onActivate} disabled={submitting || !canCoverActionFee}>
                {buttonLabel("activate", "Activate", "Activating")}
              </Button>
            )}
            {validatorSetDeployed && inSet && !exiting && (
              <Button size="sm" variant="outline" onClick={onRequestExit} disabled={submitting || !canCoverActionFee}>
                {buttonLabel("exit", "Request exit", "Requesting")}
              </Button>
            )}
            {validatorSetDeployed && inSet && exiting && (
              <Button size="sm" variant="outline" onClick={onCancelExit} disabled={submitting || !canCoverActionFee}>
                {buttonLabel("cancel-exit", `Cancel exit (${formatReleaseTime(validator?.exitReadyTime || "0")})`, "Cancelling")}
              </Button>
            )}
            {onUpdateProfile && validator && !profileDraft && (
              <Button size="sm" variant="outline" onClick={openProfile} disabled={submitting}>
                Edit profile
              </Button>
            )}
          </div>
        </div>

        <div className={`mt-4 grid gap-3 ${active ? "lg:grid-cols-3" : selfBond > 0n ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
          <div className="rounded-md bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Operator Rewards</p>
            <p className="mt-1 font-semibold">{formatToken(claimableRewards, decimals)} {symbol}</p>
            {rewardBreakdown && (
              <p className="mt-1 text-xs text-muted-foreground">{rewardBreakdown}</p>
            )}
            <Button className="mt-3 w-full" size="sm" onClick={submitClaim} disabled={!claimReady || submitting}>
              {buttonLabel("operator-claim", "Claim", "Claiming")}
            </Button>
            {fees > 0n && (
              <>
                <p className="mt-3 text-xs text-muted-foreground">Fees (USDST)</p>
                <p className="mt-1 font-semibold">{formatToken(claimableFees, 18, 2)} USDST</p>
                <Button className="mt-2 w-full" size="sm" variant="outline" onClick={onClaimFees} disabled={submitting || !canCoverActionFee}>
                  {buttonLabel("operator-claim-fees", "Claim fees", "Claiming")}
                </Button>
              </>
            )}
          </div>

          {active && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Commission</p>
                  <p className="mt-1 font-semibold">{formatPercentFromBps(currentCommissionBps)}</p>
                </div>
                <p className="text-xs text-muted-foreground">Max {formatPercentFromBps(maxCommissionBps)}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={commissionPercent}
                  onChange={(event) => setCommissionPercent(event.target.value)}
                  placeholder="New %"
                  inputMode="decimal"
                  disabled={submitting}
                />
                <Button size="sm" onClick={submitCommission} disabled={!commissionReady || submitting}>
                  {buttonLabel("commission", "Update", "Updating")}
                </Button>
              </div>
            </div>
          )}

          {(active || selfBond > 0n) && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Self-Bond</p>
                  <p className="mt-1 font-semibold">{formatToken(validator?.selfBond, decimals)} {symbol}</p>
                </div>
                {active && (
                  <p className="text-xs text-muted-foreground">Wallet {formatToken(walletBalance, decimals)}</p>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {active && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium">Add</label>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary disabled:text-muted-foreground"
                        onClick={() => setSelfBondAmount(formatAmountInput(wallet, decimals))}
                        disabled={submitting || wallet <= 0n}
                      >
                        Max
                      </button>
                    </div>
                    <Input
                      value={selfBondAmount}
                      onChange={(event) => setSelfBondAmount(event.target.value)}
                      placeholder={`0 ${symbol}`}
                      inputMode="decimal"
                      disabled={submitting}
                    />
                    <Button className="w-full" size="sm" onClick={submitSelfBond} disabled={!selfBondReady || submitting}>
                      {buttonLabel("bond", "Bond", "Bonding")}
                    </Button>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium">Unbond</label>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary disabled:text-muted-foreground"
                      onClick={() => setSelfUnbondAmount(formatAmountInput(selfBond, decimals))}
                      disabled={submitting || selfBond <= 0n}
                    >
                      Max
                    </button>
                  </div>
                  <Input
                    value={selfUnbondAmount}
                    onChange={(event) => setSelfUnbondAmount(event.target.value)}
                    placeholder={`0 ${symbol}`}
                    inputMode="decimal"
                    disabled={submitting || selfBond <= 0n}
                  />
                  <Button className="w-full" variant="outline" size="sm" onClick={submitSelfUnbond} disabled={!selfUnbondReady || submitting}>
                    {buttonLabel("self-unbond", "Unbond", "Unbonding")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {profileDraft && (
          <div className="mt-4 rounded-md bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Profile</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Input value={profileDraft.name} onChange={updateProfileField("name")} placeholder="Validator name" disabled={submitting} />
              <Input value={profileDraft.description} onChange={updateProfileField("description")} placeholder="Description" disabled={submitting} />
              <Input value={profileDraft.metadataURI} onChange={updateProfileField("metadataURI")} placeholder="Metadata URI (optional)" disabled={submitting} />
              <Input value={profileDraft.protocolValidatorId} onChange={updateProfileField("protocolValidatorId")} placeholder="Protocol validator ID (optional)" disabled={submitting} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={submitProfile} disabled={submitting || !canCoverActionFee}>
                {buttonLabel("profile", "Save profile", "Saving")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setProfileDraft(null)} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const EarnStaking = () => {
  const navigate = useNavigate();
  const { isLoggedIn, isAppAuthenticated, userAddress } = useUser();
  const { isConnected } = useAccount();
  const { resolvedTheme } = useTheme();
  const { fetchUsdstBalance, usdstBalance, voucherBalance } = useTokenContext();
  const { tokenApys } = useEarnContext();
  const { toast } = useToast();
  const [info, setInfo] = useState<StakingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingAction, setProcessingAction] = useState<ProcessingAction | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [moveAmount, setMoveAmount] = useState("");
  // Holds a validator key (see validatorKey): the operator on V1, the validator address on V2.
  const [moveTargetOperator, setMoveTargetOperator] = useState("");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [showInactiveValidators, setShowInactiveValidators] = useState(false);
  const [showAllValidators, setShowAllValidators] = useState(false);
  const [showWithdrawnHistory, setShowWithdrawnHistory] = useState(false);
  const [actionMode, setActionMode] = useState<StakingActionMode | null>(null);
  // Validator key of the row the action modal is open for.
  const [actionOperator, setActionOperator] = useState("");
  // Validator key of the operator panel an in-flight action belongs to.
  const [processingTarget, setProcessingTarget] = useState<string | null>(null);

  // Single switch for the validator-keyed staking contract (V2). V1 is operator-keyed with a reward schedule.
  const isV2 = info?.contractVersion === "v2";
  const decimals = Number(info?.tokenDecimals || 18);
  const symbol = info?.tokenSymbol || "STRATO";
  const useExternalWalletSigning = isConnected && !isAppAuthenticated;
  const stakingTxConfig = useExternalWalletSigning ? ({ walletAuth: true } as any) : undefined;

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

  usePageTitle("Stake");

  useEffect(() => {
    window.scrollTo(0, 0);
    refreshInfo();
  }, [refreshInfo]);

  useEffect(() => {
    if (isLoggedIn) fetchUsdstBalance();
  }, [isLoggedIn, fetchUsdstBalance]);

  // Fees are paid in USDST; vouchers also cover fees (same rule as the metals flow).
  const feeFunds = useMemo(
    () => BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0"),
    [usdstBalance, voucherBalance]
  );
  const canCoverStakeFee = feeFunds >= safeParseUnits(STAKING_STAKE_FEE);
  const canCoverActionFee = feeFunds >= safeParseUnits(STAKING_ACTION_FEE);

  // CATA rewards APY for the staking activity, read from the same earn map the
  // portfolio uses so the two screens always show the same combined figure.
  const stakingRewardsApy = useMemo(() => {
    const strato = (info?.stratoTokenAddress || "").toLowerCase().replace(/^0x/, "");
    if (!strato) return 0;
    const entry = tokenApys.find((t) => (t.token || "").toLowerCase().replace(/^0x/, "") === strato);
    const rewards = entry?.apys.find((a) => a.source === "rewards" && a.meta === "staking");
    const parsed = parseFloat(rewards?.apy || "0");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [tokenApys, info?.stratoTokenAddress]);

  // Native staking APY plus CATA rewards. Validator commission only applies to
  // the native part; rewards are paid directly by the Rewards contract.
  const combinedApy = (nativeApy: string): string => {
    const native = nativeApy && nativeApy !== "-" ? parseFloat(nativeApy) || 0 : 0;
    const total = native + stakingRewardsApy;
    return total > 0 ? `${total.toFixed(2)}%` : "-";
  };

  // Native / Rewards / Total rows for the shared EarnApyTooltip, matching the
  // breakdown convention used on the portfolio and Earn pages.
  const apyBreakdownInfo = (nativeApy: string): EarnApyInfo | null => {
    const native = nativeApy && nativeApy !== "-" ? parseFloat(nativeApy) || 0 : 0;
    const breakdown = [
      native > 0 ? { label: "Native APY", apy: native.toFixed(2) } : null,
      stakingRewardsApy > 0 ? { label: "Rewards APY", apy: stakingRewardsApy.toFixed(2) } : null,
    ].filter((item): item is { label: string; apy: string } => item !== null);
    if (breakdown.length === 0) return null;
    return { total: native + stakingRewardsApy, source: "staking", breakdown };
  };

  const apyWithBreakdown = (nativeApy: string): ReactNode => (
    <EarnApyTooltip info={apyBreakdownInfo(nativeApy)}>
      <span>{combinedApy(nativeApy)}</span>
    </EarnApyTooltip>
  );

  const actionButtonLabel = (action: ProcessingAction, label: string, pendingLabel: string) => (
    processingAction === action ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {pendingLabel}
      </>
    ) : label
  );

  const validators = useMemo(
    () => info?.validators || [],
    [info?.validators]
  );

  const walletBalance = useMemo(() => BigInt(info?.walletBalance || "0"), [info?.walletBalance]);
  // V1: the caller's single operator record.
  const operatorValidator = useMemo(
    () => (isV2 ? undefined : validators.find((validator) => validatorKey(validator, false) === info?.operatorAddress)),
    [info?.operatorAddress, isV2, validators]
  );
  // V2: every validator the caller operates.
  const operatedValidators = useMemo(
    () => (isV2
      ? (info?.operatedValidators || [])
        .map((address) => validators.find((validator) => sameAddress(validator.address, address)))
        .filter((validator): validator is StakingValidator => Boolean(validator))
      : []),
    [info?.operatedValidators, isV2, validators]
  );
  const showOperatorSelfBond = isV2 ? operatedValidators.length > 0 : !!info?.isOperator;
  const operatorSelfBondTotal = isV2
    ? operatedValidators.reduce((total, validator) => total + BigInt(validator.selfBond || "0"), 0n).toString()
    : operatorValidator?.selfBond;
  // A backend that predates the flag still reports the full validator set, so only an
  // explicit false hides these controls.
  const validatorSetDeployed = info?.validatorSetDeployed !== false;
  const claimableFees = useMemo(() => BigInt(info?.claimableFees || "0"), [info?.claimableFees]);
  const totalStakeAmount = useMemo(() => safeParseUnits(stakeAmount, decimals), [decimals, stakeAmount]);
  const apyLabel = isV2 ? "APY (7d)" : "Est. APY";

  const filteredValidators = useMemo(() => {
    const query = validatorSearch.trim().toLowerCase();
    const visibleValidators = showInactiveValidators
      ? validators
      : validators.filter((validator) => validator.active);

    if (!query) return visibleValidators;

    return visibleValidators.filter((validator) => [
      validator.name,
      validator.description,
      validator.protocolValidatorId,
      validator.address,
      validator.validatorAddress,
      validator.operator,
    ].some((value) => (value || "").toLowerCase().includes(query)));
  }, [showInactiveValidators, validatorSearch, validators]);

  const displayedValidators = showAllValidators
    ? filteredValidators
    : filteredValidators.slice(0, VALIDATOR_DISPLAY_LIMIT);

  const actionValidator = useMemo(
    () => validators.find((validator) => validatorKey(validator, isV2) === actionOperator),
    [actionOperator, isV2, validators]
  );

  const actionValidatorOperator = actionValidator ? validatorKey(actionValidator, isV2) : "";
  const actionValidatorLabel = actionValidator
    ? actionValidator.name || truncateAddress(actionValidatorOperator, 8, 6)
    : "";
  const activeMoveTargetValidators = useMemo(
    () => validators.filter((validator) => validator.active && validatorKey(validator, isV2) !== actionValidatorOperator),
    [actionValidatorOperator, isV2, validators]
  );
  const moveTargetValidator = useMemo(
    () => validators.find((validator) => validatorKey(validator, isV2) === moveTargetOperator),
    [isV2, moveTargetOperator, validators]
  );
  const actionValidatorStake = BigInt(actionValidator?.userStake || "0");
  const actionValidatorRewards = BigInt(actionValidator?.pendingRewards || "0");
  const unstakeAmountParsed = useMemo(() => safeParseUnits(unstakeAmount, decimals), [decimals, unstakeAmount]);
  const moveAmountParsed = useMemo(() => safeParseUnits(moveAmount, decimals), [decimals, moveAmount]);
  const stakeReady =
    isLoggedIn &&
    canCoverStakeFee &&
    !!actionValidator?.active &&
    totalStakeAmount > 0n &&
    totalStakeAmount <= walletBalance;
  const claimReady =
    isLoggedIn &&
    canCoverActionFee &&
    !!actionValidator &&
    actionValidatorRewards > 0n;
  const unstakeReady =
    isLoggedIn &&
    canCoverActionFee &&
    !!actionValidator &&
    actionValidatorStake > 0n &&
    unstakeAmountParsed > 0n &&
    unstakeAmountParsed <= actionValidatorStake;
  const moveReady =
    isLoggedIn &&
    canCoverActionFee &&
    !!actionValidator &&
    actionValidatorStake > 0n &&
    moveAmountParsed > 0n &&
    moveAmountParsed <= actionValidatorStake &&
    !!moveTargetValidator?.active &&
    moveTargetOperator !== actionValidatorOperator;

  const readyUnbondingRequests = useMemo(
    () => (info?.unbondingRequests || []).filter((request) => request.ready && !request.claimed),
    [info?.unbondingRequests]
  );

  const withdrawalQueue = useMemo(() => {
    const requests = info?.unbondingRequests || [];
    const active = requests
      .filter((request) => !request.claimed)
      .sort((a, b) => (a.ready === b.ready ? Number(a.releaseTime) - Number(b.releaseTime) : a.ready ? -1 : 1));
    const withdrawn = requests.filter((request) => request.claimed);

    let unbondingTotal = 0n;
    let readyTotal = 0n;
    for (const request of active) {
      if (request.ready) {
        readyTotal += BigInt(request.amount || "0");
      } else {
        unbondingTotal += BigInt(request.amount || "0");
      }
    }

    return { active, withdrawn, unbondingTotal, readyTotal };
  }, [info?.unbondingRequests]);

  // Resolves true once the transaction and the refresh both succeed.
  const runAction = async (
    action: () => Promise<void>,
    successTitle: string,
    processing: ProcessingAction,
    target?: string
  ): Promise<boolean> => {
    try {
      setSubmitting(true);
      setProcessingAction(processing);
      setProcessingTarget(target ?? null);
      await action();
      toast({ title: successTitle, variant: "success" });
      await refreshInfo();
      return true;
    } catch (error: unknown) {
      toast({
        title: "Transaction failed",
        description: stakingActionErrorMessage(error),
        variant: "destructive",
      });
      return false;
    } finally {
      setSubmitting(false);
      setProcessingAction(null);
      setProcessingTarget(null);
    }
  };

  const openActionModal = (validator: StakingValidator, mode: StakingActionMode) => {
    const key = validatorKey(validator, isV2);
    const defaultMoveTarget = mode === "move"
      ? validators.find((candidate) => candidate.active && validatorKey(candidate, isV2) !== key)
      : null;

    setActionOperator(key);
    setActionMode(mode);
    setStakeAmount("");
    setUnstakeAmount("");
    setMoveAmount("");
    setMoveTargetOperator(defaultMoveTarget ? validatorKey(defaultMoveTarget, isV2) : "");
  };

  const closeActionModal = () => {
    setActionMode(null);
    setActionOperator("");
    setStakeAmount("");
    setUnstakeAmount("");
    setMoveAmount("");
    setMoveTargetOperator("");
  };

  // Request bodies name validators on V2; V1 bodies stay exactly what the operator-keyed contract expects.
  const delegationTarget = (key: string) => (isV2 ? { validator: key } : { operator: key });
  const claimTargets = (key: string) => (isV2 ? { validators: [key] } : { operators: [key] });
  // Operator writes: V2 targets one validator; V1 acts on the caller's operator record.
  const operatorBody = (validator: string, v1Body?: Record<string, string>) =>
    (isV2 ? { ...v1Body, validator } : v1Body);

  const handleStake = async () => {
    if (!stakeReady || !actionValidatorOperator) return;
    await runAction(
      async () => {
        await api.post("/staking/stake", {
          delegations: [{ ...delegationTarget(actionValidatorOperator), amount: totalStakeAmount.toString() }],
        }, stakingTxConfig);
        closeActionModal();
        setStakeAmount("");
      },
      "Stake submitted",
      "stake"
    );
  };

  const handleUnstake = async () => {
    if (!unstakeReady || !actionValidatorOperator) return;

    await runAction(
      async () => {
        await api.post("/staking/unstake", { ...delegationTarget(actionValidatorOperator), amount: unstakeAmountParsed.toString() }, stakingTxConfig);
        closeActionModal();
        setUnstakeAmount("");
      },
      "Unstake submitted",
      "unstake"
    );
  };

  const handleMoveStake = async () => {
    if (!moveReady || !actionValidatorOperator || !moveTargetOperator) return;

    await runAction(
      async () => {
        const amount = moveAmountParsed.toString();
        await api.post("/staking/move", isV2
          ? { fromValidator: actionValidatorOperator, toValidator: moveTargetOperator, amount }
          : { fromOperator: actionValidatorOperator, toOperator: moveTargetOperator, amount },
        stakingTxConfig);
        closeActionModal();
        setMoveAmount("");
      },
      "Move submitted",
      "move"
    );
  };

  const handleClaim = async (operator?: string) => {
    await runAction(
      async () => {
        await api.post("/staking/claim", operator ? claimTargets(operator) : { claimAll: true }, stakingTxConfig);
      },
      "Claim submitted",
      "claim"
    );
  };

  const handleModalClaim = async () => {
    if (!claimReady || !actionValidatorOperator) return;
    await runAction(
      async () => {
        await api.post("/staking/claim", claimTargets(actionValidatorOperator), stakingTxConfig);
        closeActionModal();
      },
      "Claim submitted",
      "claim"
    );
  };

  const handleWithdrawReady = async () => {
    await runAction(
      async () => {
        await api.post("/staking/withdraw-unbonded", { withdrawAll: true }, stakingTxConfig);
      },
      "Withdrawal submitted",
      "withdraw"
    );
  };

  const handleOperatorClaim = (validator: string) =>
    runAction(
      async () => {
        await api.post("/staking/operator/claim", operatorBody(validator), stakingTxConfig);
      },
      "Operator claim submitted",
      "operator-claim",
      validator
    );

  const handleOperatorCommission = (validator: string, commissionBps: bigint) =>
    runAction(
      async () => {
        await api.post("/staking/commission", operatorBody(validator, { commissionBps: commissionBps.toString() }), stakingTxConfig);
      },
      "Commission update submitted",
      "commission",
      validator
    );

  const handleSelfBond = (validator: string, amount: bigint) =>
    runAction(
      async () => {
        await api.post("/staking/self-bond", operatorBody(validator, { amount: amount.toString() }), stakingTxConfig);
      },
      "Self-bond submitted",
      "bond",
      validator
    );

  const handleSelfUnbond = (validator: string, amount: bigint) =>
    runAction(
      async () => {
        await api.post("/staking/self-unbond", operatorBody(validator, { amount: amount.toString() }), stakingTxConfig);
      },
      "Self-unbond submitted",
      "self-unbond",
      validator
    );

  const handleClaimFees = async () => {
    await runAction(
      async () => {
        await api.post("/staking/claim-fees", { claimAll: true }, stakingTxConfig);
      },
      "Fee claim submitted",
      "claim-fees"
    );
  };

  const handleOperatorClaimFees = (validator: string) =>
    runAction(
      async () => {
        await api.post("/staking/operator/claim-fees", operatorBody(validator), stakingTxConfig);
      },
      "Operator fee claim submitted",
      "operator-claim-fees",
      validator
    );

  const handleRegister = (input: RegisterValidatorInput) =>
    runAction(
      async () => {
        const body = isV2
          ? {
            validator: input.validator,
            commissionBps: input.commissionBps,
            name: input.name,
            description: input.description,
            ...(input.signature ? { signature: input.signature } : {}),
          }
          : {
            name: input.name,
            description: input.description,
            commissionBps: input.commissionBps,
            validatorAddress: input.validator,
          };
        await api.post("/staking/register", body, stakingTxConfig);
      },
      "Registration submitted",
      "register"
    );

  const handleUpdateProfile = (validator: string, profile: OperatorProfileInput) =>
    runAction(
      async () => {
        await api.post("/staking/profile", { validator, ...profile }, stakingTxConfig);
      },
      "Profile update submitted",
      "profile",
      validator
    );

  const handleActivate = (validator: string) =>
    runAction(
      async () => {
        await api.post("/staking/activate", operatorBody(validator, {}), stakingTxConfig);
      },
      "Activation submitted",
      "activate",
      validator
    );

  const handleRequestExit = (validator: string) =>
    runAction(
      async () => {
        await api.post("/staking/exit", operatorBody(validator), stakingTxConfig);
      },
      "Exit requested",
      "exit",
      validator
    );

  const handleCancelExit = (validator: string) =>
    runAction(
      async () => {
        await api.post("/staking/exit/cancel", operatorBody(validator), stakingTxConfig);
      },
      "Exit cancelled",
      "cancel-exit",
      validator
    );

  const setMaxStakeAmount = () => {
    if (!info) return;
    setStakeAmount(formatAmountInput(BigInt(info.walletBalance || "0"), decimals));
  };

  const setMaxUnstakeAmount = () => {
    setUnstakeAmount(formatAmountInput(actionValidatorStake, decimals));
  };

  const setMaxMoveAmount = () => {
    setMoveAmount(formatAmountInput(actionValidatorStake, decimals));
  };

  const selfBondNote = isV2 && info
    ? selfBondRequirementText(info, `${formatToken(info.minStake, decimals, 0)} ${symbol}`)
    : undefined;

  const renderOperatorPanel = (
    key: string,
    validator: StakingValidator | undefined,
    earnings: Pick<OperatorPanelProps, "claimableRewards" | "claimableFees" | "rewardBreakdown" | "currentCommissionBps">
  ) => (
    <OperatorPanel
      key={key || "operator"}
      isV2={isV2}
      validator={validator}
      {...earnings}
      maxCommissionBps={info?.maxCommissionBps || "0"}
      walletBalance={info?.walletBalance || "0"}
      minStake={info?.minStake || "0"}
      decimals={decimals}
      symbol={symbol}
      selfBondNote={selfBondNote}
      selfBondRuleActive={Boolean(info?.selfBondRuleActive)}
      validatorSetDeployed={validatorSetDeployed}
      canManage={isLoggedIn && (isV2 || !!info?.isOperator)}
      joinsPaused={Boolean(info?.joinsPaused)}
      canCoverActionFee={canCoverActionFee}
      submitting={submitting}
      processing={processingTarget === key ? processingAction : null}
      onClaim={() => handleOperatorClaim(key)}
      onClaimFees={() => handleOperatorClaimFees(key)}
      onCommission={(commissionBps) => handleOperatorCommission(key, commissionBps)}
      onSelfBond={(amount) => handleSelfBond(key, amount)}
      onSelfUnbond={(amount) => handleSelfUnbond(key, amount)}
      onActivate={() => handleActivate(key)}
      onRequestExit={() => handleRequestExit(key)}
      onCancelExit={() => handleCancelExit(key)}
      onUpdateProfile={isV2 ? (profile) => handleUpdateProfile(key, profile) : undefined}
    />
  );

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
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Available to Stake"
            tooltip="STRATO available in your wallet to stake."
            value={`${formatToken(info.walletBalance, decimals)} ${symbol}`}
            icon={Wallet}
          />
          <StatCard
            label="Amount Staked"
            tooltip="Total STRATO you currently have delegated across all validators."
            value={`${formatToken(info.userTotalStake, decimals)} ${symbol}`}
            icon={Layers}
          />
          <StatCard
            label="APY"
            tooltip={isV2
              ? "Annual yield delegators realized over the last 7 days from STRATO block rewards, net of validator commission. Rewards APY comes from platform reward emissions."
              : "Estimated annual yield for delegating STRATO. Native APY comes from the staking reward schedule, net of validator commission. Rewards APY comes from platform reward emissions."}
            value={apyWithBreakdown(info.estimatedApy)}
            icon={TrendingUp}
          />
          <StatCard
            label="Total Rewards"
            tooltip="Lifetime STRATO you've earned through staking, including rewards already claimed."
            value={`${formatToken(info.totalEarned, decimals)} ${symbol}`}
            icon={Trophy}
          />
          <StatCard
            label="Claimable"
            tooltip="Rewards you've earned and can claim now without unstaking your delegated STRATO. Claiming doesn't affect your staked balance."
            value={`${formatToken(info.claimableRewards, decimals)} ${symbol}`}
            icon={Gift}
          />
          {claimableFees > 0n && (
            <StatCard
              label="Claimable Fees"
              tooltip="Your share of the transaction fees earned by the validators you delegate to, paid in USDST."
              value={`${formatToken(info.claimableFees, 18, 2)} USDST`}
              icon={Gift}
            />
          )}
          {showOperatorSelfBond && (
            <StatCard
              label="Self-Bond"
              tooltip={isV2
                ? "STRATO you've bonded across the validators you operate. Separate from delegated stake."
                : "STRATO you've bonded as a validator operator. Separate from delegated stake."}
              value={`${formatToken(operatorSelfBondTotal, decimals)} ${symbol}`}
              icon={Shield}
            />
          )}
        </div>

        {isLoggedIn && !canCoverStakeFee && (
          <p className="text-xs text-yellow-600">
            You need USDST or vouchers to cover transaction fees — fund your account before staking.
          </p>
        )}

        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <img
              src={resolvedTheme === "dark" ? STRATOICONDARK : STRATOICON}
              alt="STRATO"
              className="h-14 w-14 shrink-0 rounded-lg"
            />
            <div className="min-w-0">
              {isV2 ? (
                <>
                  <p className="text-xs text-muted-foreground">Staking Rewards</p>
                  <p className="mt-1 text-lg font-semibold">STRATO block rewards</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Validators earn STRATO for each block they propose plus USDST proposer fees, split between the
                    operator's self-bond and delegators after commission. APY is what delegators realized over the last 7 days.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Reward Period</p>
                  <p className="mt-1 text-lg font-semibold">{info.rewardPeriodName || "STRATO staking rewards"}</p>
                  {info.rewardPeriodDescription && (
                    <p className="mt-1 text-sm text-muted-foreground">{info.rewardPeriodDescription}</p>
                  )}
                </>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {isV2
                  ? `${formatToken(info.totalRewardsCredited, decimals)} ${symbol} credited to date`
                  : formatRewardPeriodStatus(info.periodStart, info.periodFinish)}
                {" · "}
                <a
                  href="https://docs.strato.nexus/tokenomics/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Learn More &raquo;
                </a>
              </p>
            </div>
          </CardContent>
        </Card>

        {isLoggedIn && !isV2 && info.isOperator && renderOperatorPanel(info.operatorAddress, operatorValidator, {
          claimableRewards: info.operatorClaimableRewards,
          claimableFees: info.operatorClaimableFees,
          rewardBreakdown: `Base ${formatToken(info.operatorPendingBaseRewards, decimals)} · Commission ${formatToken(info.operatorPendingCommission, decimals)} · Self-bond ${formatToken(info.operatorPendingSelfBondRewards, decimals)}`,
          currentCommissionBps: info.currentOperatorCommissionBps,
        })}

        {isLoggedIn && isV2 && operatedValidators.map((validator) => renderOperatorPanel(validator.address, validator, {
          claimableRewards: validator.operatorPendingRewards || "0",
          claimableFees: validator.operatorPendingFees || "0",
          // The info-level split describes a single operated validator; with several there is no per-validator split.
          rewardBreakdown: operatedValidators.length === 1
            ? `Self-bond ${formatToken(info.operatorPendingSelfBondRewards, decimals)} · Commission ${formatToken(info.operatorPendingCommission, decimals)}`
            : "",
          currentCommissionBps: validator.commissionBps,
        }))}

        {isLoggedIn && (isV2 || !info.isOperator) && validatorSetDeployed && (
          <BecomeValidatorCard
            isV2={isV2}
            connectedAddress={userAddress}
            hasValidators={operatedValidators.length > 0}
            requirementNote={selfBondNote}
            minStake={formatToken(info.minStake, decimals, 0)}
            maxCommissionBps={info.maxCommissionBps}
            symbol={symbol}
            disabled={!canCoverActionFee}
            submitting={submitting && processingAction === "register"}
            onRegister={handleRegister}
          />
        )}

        {!isLoggedIn && <GuestSignInBanner message="Connect your wallet to stake STRATO." />}


        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Validators</h2>
                <p className="text-sm text-muted-foreground">
                  {info.validatorCount} in the validator set{Number(info.maxActiveValidators || "0") > 0 ? ` of ${info.maxActiveValidators}` : ""}
                  {validatorSetDeployed ? ` · ${info.activeValidatorCount} listed` : ""} · unbonding {formatDuration(info.unbondingSeconds)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={refreshInfo} disabled={loading || submitting}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                {claimableFees > 0n && (
                  <Button variant="outline" size="sm" onClick={handleClaimFees} disabled={!isLoggedIn || submitting || !canCoverActionFee}>
                    {actionButtonLabel("claim-fees", "Claim Fees", "Claiming")}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => handleClaim()}
                  disabled={!isLoggedIn || submitting || BigInt(info.claimableRewards || "0") <= 0n}
                >
                  {actionButtonLabel("claim", "Claim All", "Claiming")}
                </Button>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative sm:w-80">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={validatorSearch}
                      onChange={(event) => setValidatorSearch(event.target.value)}
                      placeholder="Search validators"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex rounded-md border border-border p-1">
                    <Button
                      variant={!showInactiveValidators ? "default" : "ghost"}
                      size="sm"
                      className="h-8"
                      onClick={() => setShowInactiveValidators(false)}
                    >
                      Active
                    </Button>
                    <Button
                      variant={showInactiveValidators ? "default" : "ghost"}
                      size="sm"
                      className="h-8"
                      onClick={() => setShowInactiveValidators(true)}
                    >
                      All
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Showing {displayedValidators.length} of {validators.length}
                </p>
              </div>

              <div className="space-y-3 md:hidden">
                {displayedValidators.map((validator) => {
                  const rowKey = validatorKey(validator, isV2);
                  const label = validator.name || truncateAddress(rowKey, 8, 6);
                  const userStake = BigInt(validator.userStake || "0");
                  const pendingRewards = BigInt(validator.pendingRewards || "0");
                  const hasMoveTarget = validators.some((candidate) => candidate.active && validatorKey(candidate, isV2) !== rowKey);

                  return (
                    <div key={rowKey} className="rounded-lg border border-border px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{label}</p>
                          {validator.description && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{validator.description}</p>
                          )}
                          {isV2 && validator.operator && (
                            <p className="mt-0.5 text-xs text-muted-foreground">Operator {truncateAddress(validator.operator, 8, 6)}</p>
                          )}
                        </div>
                        <ValidatorStatusBadge validator={validator} />
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Total Stake</p>
                          <p className="font-semibold">{formatToken(validator.totalStake, decimals)} {symbol}</p>
                        </div>
                        {validatorSetDeployed && (
                          <div className="rounded-md bg-muted/30 px-3 py-2">
                            <p className="text-xs text-muted-foreground">Blocks</p>
                            <p className="font-semibold">{validator.blocksProposed} <span className="text-xs font-normal text-muted-foreground">({validator.missedProposals} missed)</span></p>
                          </div>
                        )}
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Your Stake</p>
                          <p className="font-semibold">{formatToken(validator.userStake, decimals)} {symbol}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Rewards</p>
                          <p className="font-semibold">{formatToken(validator.pendingRewards, decimals)} {symbol}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">{apyLabel}</p>
                          <p className="font-semibold">{apyWithBreakdown(validator.estimatedApy)}</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Commission</p>
                          <p className="font-semibold">{formatPercentFromBps(validator.commissionBps)}</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          className="w-full"
                          size="sm"
                          onClick={() => openActionModal(validator, "stake")}
                          disabled={!isLoggedIn || !canCoverStakeFee || !validator.active || submitting}
                        >
                          Stake
                        </Button>
                        <Button
                          className="w-full"
                          variant="outline"
                          size="sm"
                          onClick={() => openActionModal(validator, "claim")}
                          disabled={!isLoggedIn || !canCoverActionFee || pendingRewards <= 0n || submitting}
                        >
                          Claim
                        </Button>
                        {SHOW_MOVE_BUTTON && (
                          <Button
                            className="w-full"
                            variant="outline"
                            size="sm"
                            onClick={() => openActionModal(validator, "move")}
                            disabled={!isLoggedIn || userStake <= 0n || !hasMoveTarget || submitting}
                          >
                            Move
                          </Button>
                        )}
                        <Button
                          className="w-full"
                          variant="outline"
                          size="sm"
                          onClick={() => openActionModal(validator, "unstake")}
                          disabled={!isLoggedIn || !canCoverActionFee || userStake <= 0n || submitting}
                        >
                          Unstake
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {filteredValidators.length === 0 && (
                  <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                    No validators.
                  </div>
                )}
              </div>

              <div className="hidden max-h-[34rem] overflow-auto rounded-lg border border-border md:block">
                <table className="w-full min-w-[1320px]">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Validator</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                        <TipLabel
                          label="Status"
                          tooltip={`Active validators are in the consensus set and propose blocks in proportion to their stake. Registered ${isV2 ? "validators" : "operators"} can receive stake but are not yet in the set.`}
                        />
                      </th>
                      {validatorSetDeployed && (
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                          <TipLabel label="Blocks" tooltip="Blocks this validator has proposed, and proposals it missed when it was the intended proposer." />
                        </th>
                      )}
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        <TipLabel label="Total Stake" tooltip="All STRATO staked with this validator, including delegations and the operator's self-bond." />
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        <TipLabel label="Your Stake" tooltip="STRATO you have delegated to this validator." />
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        <TipLabel label="Rewards" tooltip="Rewards you've accrued from this validator and can claim now." />
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        <TipLabel
                          label={apyLabel}
                          tooltip={isV2
                            ? "Annual yield this validator's delegators realized from STRATO block rewards over the last 7 days, after its commission, plus platform Rewards APY when active."
                            : "Estimated annual yield from this validator: Native APY after its commission, plus platform Rewards APY when active."}
                        />
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                        <TipLabel label="Commission" tooltip="The percentage of your staking rewards this validator keeps as a fee for operating the node." />
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedValidators.map((validator) => {
                      const rowKey = validatorKey(validator, isV2);
                      const label = validator.name || truncateAddress(rowKey, 8, 6);
                      const userStake = BigInt(validator.userStake || "0");
                      const pendingRewards = BigInt(validator.pendingRewards || "0");
                      const hasMoveTarget = validators.some((candidate) => candidate.active && validatorKey(candidate, isV2) !== rowKey);

                      return (
                        <tr key={rowKey} className="border-b border-border/50 last:border-b-0 hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <div className="min-w-0">
                              <p className="font-medium">{label}</p>
                              {validator.description && (
                                <p className="mt-0.5 max-w-[28rem] truncate text-xs text-muted-foreground">{validator.description}</p>
                              )}
                              {isV2 && validator.operator && (
                                <p className="mt-0.5 text-xs text-muted-foreground">Operator {truncateAddress(validator.operator, 8, 6)}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm"><ValidatorStatusBadge validator={validator} /></td>
                          {validatorSetDeployed && (
                            <td className="px-4 py-3 text-right text-sm">
                              {validator.blocksProposed}
                              <span className="ml-1 text-xs text-muted-foreground">({validator.missedProposals} missed)</span>
                            </td>
                          )}
                          <td className="px-4 py-3 text-right text-sm">{formatToken(validator.totalStake, decimals)}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatToken(validator.userStake, decimals)}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatToken(validator.pendingRewards, decimals)}</td>
                          <td className="px-4 py-3 text-right text-sm">{apyWithBreakdown(validator.estimatedApy)}</td>
                          <td className="px-4 py-3 text-right text-sm">{formatPercentFromBps(validator.commissionBps)}</td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                onClick={() => openActionModal(validator, "stake")}
                                disabled={!isLoggedIn || !canCoverStakeFee || !validator.active || submitting}
                              >
                                Stake
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openActionModal(validator, "claim")}
                                disabled={!isLoggedIn || !canCoverActionFee || pendingRewards <= 0n || submitting}
                              >
                                Claim
                              </Button>
                              {SHOW_MOVE_BUTTON && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openActionModal(validator, "move")}
                                  disabled={!isLoggedIn || userStake <= 0n || !hasMoveTarget || submitting}
                                >
                                  Move
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openActionModal(validator, "unstake")}
                                disabled={!isLoggedIn || !canCoverActionFee || userStake <= 0n || submitting}
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
                        <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={9}>
                          No validators.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {filteredValidators.length > VALIDATOR_DISPLAY_LIMIT && (
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllValidators((current) => !current)}>
                    {showAllValidators ? "Show less" : `Show all ${filteredValidators.length} validators`}
                  </Button>
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
                <div>
                  <h2 className="text-lg font-semibold">Withdrawals</h2>
                  <p className="text-sm text-muted-foreground">
                    Unbonding{" "}
                    <span className="font-semibold text-foreground">
                      {formatToken(withdrawalQueue.unbondingTotal.toString(), decimals)} {symbol}
                    </span>
                    {" · "}
                    Ready{" "}
                    <span className="font-semibold text-foreground">
                      {formatToken(withdrawalQueue.readyTotal.toString(), decimals)} {symbol}
                    </span>
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleWithdrawReady}
                disabled={!isLoggedIn || !canCoverActionFee || submitting || readyUnbondingRequests.length === 0}
              >
                {processingAction === "withdraw" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {processingAction === "withdraw" ? "Withdrawing" : "Withdraw"}
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {withdrawalQueue.active.map((request) => (
                <div key={request.id} className="flex flex-col gap-1 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium">{formatToken(request.amount, decimals)} {symbol}</p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{request.ready ? "Ready" : formatReleaseTime(request.releaseTime)}</span>
                    {request.ready && <Badge variant="secondary">Ready</Badge>}
                  </div>
                </div>
              ))}

              {withdrawalQueue.active.length === 0 && (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No pending withdrawals.
                </div>
              )}

              {withdrawalQueue.withdrawn.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setShowWithdrawnHistory((current) => !current)}
                  >
                    {showWithdrawnHistory ? "Hide" : "Show"} withdrawn ({withdrawalQueue.withdrawn.length})
                  </button>

                  {showWithdrawnHistory && (
                    <div className="mt-2 space-y-2">
                      {withdrawalQueue.withdrawn.map((request) => (
                        <div key={request.id} className="flex flex-col gap-1 rounded-lg border border-border/50 px-4 py-3 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                          <p className="font-medium">{formatToken(request.amount, decimals)} {symbol}</p>
                          <span className="text-sm">Withdrawn</span>
                        </div>
                      ))}
                    </div>
                  )}
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

        <main className="p-4 md:p-6">
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
                  {actionMode === "move" && "Move Stake"}
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
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-muted/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground">{apyLabel}</p>
                      <p className="font-semibold">{apyWithBreakdown(actionValidator.estimatedApy)}</p>
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

                  {actionMode === "move" && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">To Validator</label>
                        <Select
                          value={moveTargetOperator}
                          onValueChange={setMoveTargetOperator}
                          disabled={!isLoggedIn || activeMoveTargetValidators.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select validator" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeMoveTargetValidators.map((validator) => {
                              const targetKey = validatorKey(validator, isV2);
                              const label = validator.name || truncateAddress(targetKey, 8, 6);
                              return (
                                <SelectItem key={targetKey} value={targetKey}>
                                  {label}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-sm font-medium">Amount</label>
                          <button
                            type="button"
                            className="text-xs font-medium text-primary disabled:text-muted-foreground"
                            onClick={setMaxMoveAmount}
                            disabled={!isLoggedIn || actionValidatorStake <= 0n}
                          >
                            Max
                          </button>
                        </div>
                        <Input
                          value={moveAmount}
                          onChange={(event) => setMoveAmount(event.target.value)}
                          placeholder={`0 ${symbol}`}
                          inputMode="decimal"
                          disabled={!isLoggedIn || actionValidatorStake <= 0n}
                        />
                        <p className="text-xs text-muted-foreground">
                          Your stake: {formatToken(actionValidator.userStake, decimals)} {symbol}
                        </p>
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={closeActionModal} disabled={submitting}>
                      Cancel
                    </Button>
                    {actionMode === "stake" && (
                      <Button onClick={handleStake} disabled={!stakeReady || submitting}>
                        {actionButtonLabel("stake", "Stake", "Staking")}
                      </Button>
                    )}
                    {actionMode === "claim" && (
                      <Button onClick={handleModalClaim} disabled={!claimReady || submitting}>
                        {actionButtonLabel("claim", "Claim", "Claiming")}
                      </Button>
                    )}
                    {actionMode === "unstake" && (
                      <Button onClick={handleUnstake} disabled={!unstakeReady || submitting}>
                        {actionButtonLabel("unstake", "Unstake", "Unstaking")}
                      </Button>
                    )}
                    {actionMode === "move" && (
                      <Button onClick={handleMoveStake} disabled={!moveReady || submitting}>
                        {actionButtonLabel("move", "Move", "Moving")}
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
