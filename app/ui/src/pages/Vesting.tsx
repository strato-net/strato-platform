import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { CirclePause, CircleX, Loader2, RefreshCw } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import CopyButton from "@/components/ui/copy";
import { api, type WalletTxProgressEvent, type WalletTxProgressHandler } from "@/lib/axios";
import { VESTING_CLAIM_CALLS } from "@/lib/constants";
import NetworkFee, { FeeNotices } from "@/components/NetworkFee";
import { feeShortfall } from "@/utils/feeUtils";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useToast } from "@/hooks/use-toast";
import { useVestings, vestingsQueryKey, type VestingStatus, type VestingSummary, type VestingView } from "@/hooks/useVestings";
import { formatBalance } from "@/utils/numberUtils";

const TOKEN_SYMBOL = "STRATO";
const TOKEN_DECIMALS = 18;
// Cirrus indexes a claim a few seconds after the block, so an immediate refetch would return the old row.
const CIRRUS_LAG_MS = 2500;
// The house hero banner (GuestPromoSection) and its eyebrow (MemberBenefitDialog).
const HERO_GRADIENT = "linear-gradient(135deg, #0A0F29 0%, #001B70 55%, #102a80 100%)";

type ClaimTxConfig = AxiosRequestConfig & { walletAuth: true; walletTxProgress: WalletTxProgressHandler };

// ---- numbers ----

const toBigInt = (value: string | undefined): bigint => {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
};

/** "2,500.50" for figures; the symbol is set beside the number, not inside it. */
const formatAmount = (atoms: string | bigint): string =>
  formatBalance(atoms, undefined, TOKEN_DECIMALS, 2, 2);

const formatStrato = (atoms: string | bigint): string => `${formatAmount(atoms)} ${TOKEN_SYMBOL}`;

// Per-mille ratio of part over whole, as a 0..100 number with one decimal.
const percentOf = (part: bigint, whole: bigint): number => {
  if (whole <= 0n) return 0;
  if (part >= whole) return 100;
  return Number((part * 1000n) / whole) / 10;
};

const vestedPercent = (vesting: VestingView): number =>
  percentOf(toBigInt(vesting.vested), toBigInt(vesting.amount));

// amount / durationWeeks / 7 in atoms; only meaningful while the vesting is accruing.
const dailyAccrual = (vesting: VestingView): bigint => {
  if (vesting.durationWeeks <= 0) return 0n;
  return toBigInt(vesting.amount) / BigInt(vesting.durationWeeks * 7);
};

const sumVestings = (vestings: VestingView[]): VestingSummary => {
  const totals = { amount: 0n, vested: 0n, claimed: 0n, claimable: 0n, locked: 0n, returned: 0n };
  for (const vesting of vestings) {
    totals.amount += toBigInt(vesting.amount);
    totals.vested += toBigInt(vesting.vested);
    totals.claimed += toBigInt(vesting.amountClaimed);
    totals.claimable += toBigInt(vesting.claimable);
    totals.locked += toBigInt(vesting.locked);
    totals.returned += toBigInt(vesting.returned);
  }
  return {
    amount: totals.amount.toString(),
    vested: totals.vested.toString(),
    claimed: totals.claimed.toString(),
    claimable: totals.claimable.toString(),
    locked: totals.locked.toString(),
    returned: totals.returned.toString(),
  };
};

// ---- time ----

const toDate = (seconds: number): Date => new Date(seconds * 1000);

const formatDay = (seconds: number): string =>
  toDate(seconds).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const formatCountdown = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const truncateHex = (value: string): string => (value.length > 16 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value);

const canClaim = (vesting: VestingView): boolean =>
  vesting.status !== "not_started" && toBigInt(vesting.claimable) > 0n;

// ---- status ----

// This branch's tailwind config has no success/warning tokens and Badge has only four variants,
// so paused reuses the text-yellow-600 class EarnStaking already uses for warnings.
const STATUS_BADGE: Record<VestingStatus, { label: string; variant: BadgeProps["variant"]; className?: string }> = {
  not_started: { label: "Not started", variant: "outline" },
  vesting: { label: "Vesting", variant: "default" },
  paused: { label: "Paused", variant: "outline", className: "text-yellow-600 border-yellow-600/40" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  fully_vested: { label: "Fully vested", variant: "secondary" },
  complete: { label: "Complete", variant: "secondary" },
};

// ---- errors ----

const progressLabel = (event: WalletTxProgressEvent): string => {
  switch (event.status) {
    case "signing":
      return "Waiting for your wallet signature…";
    case "submitting":
      return "Submitting the transaction…";
    case "failed":
      return event.error || "Transaction failed";
    default:
      return "Submitted, waiting for the block…";
  }
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

const apiErrorMessage = (error: unknown): string => {
  const failure = recordFromUnknown(error);
  const response = recordFromUnknown(failure?.response);
  const data = recordFromUnknown(response?.data);

  return readableErrorMessage(data?.error)
    || readableErrorMessage(data?.message)
    || readableErrorMessage(error)
    || "Please try again.";
};

// VestingPool revert reasons (and the paused-token transfer guard) mapped to user-facing text.
const CONTRACT_ERROR_TEXT: Array<[needle: string, text: string]> = [
  ["Can only be claimed by vesting owner", "Only the vesting's account can claim. Sign in with the account that owns this vesting."],
  ["Trying to claim too many tokens", "The claim exceeds what has vested right now. Refresh and try again."],
  ["Cannot claim to 0-address", "No beneficiary address was resolved."],
  ["Vesting not active yet", "This vesting has not started yet."],
  ["not whitelisted", "Claims are not enabled yet: the STRATO token is paused and the vesting pool is not yet allowed to transfer it."],
];

const claimErrorMessage = (error: unknown): string => {
  const raw = apiErrorMessage(error);
  const lowered = raw.toLowerCase();
  const mapped = CONTRACT_ERROR_TEXT.find(([needle]) => lowered.includes(needle.toLowerCase()));
  return mapped ? mapped[1] : raw;
};

// ---- building blocks ----

/** Local time inline, the UTC instant in the tooltip. */
const LocalDate = ({ seconds, prefix, short }: { seconds: number; prefix?: string; short?: boolean }) => {
  const date = toDate(seconds);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{prefix}{short ? formatDay(seconds) : date.toLocaleString()}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{date.toISOString()}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface VestingRingProps {
  /** Share already claimed, 0..100. Drawn on top in the deepest step of the ramp. */
  claimedPercent: number;
  /** Share vested (claimed + claimable), 0..100. Drawn beneath in the mid step. */
  vestedPercent: number;
  size: number;
  stroke: number;
  /** "card" draws the blue ramp on a card surface, "hero" the white ramp on the navy banner. */
  tone: "card" | "hero";
  label: string;
  children?: ReactNode;
}

// A circular meter: one hue ramp, fill over a lighter track, so the state reads at a glance.
// The arcs animate from zero on mount; reduced-motion users get the final state immediately.
const VestingRing = ({ claimedPercent, vestedPercent, size, stroke, tone, label, children }: VestingRingProps) => {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = (percent: number) => circumference * (1 - (drawn ? Math.min(100, Math.max(0, percent)) : 0) / 100);
  // Hero: the white ramp on navy. Card: the blue ramp, whose deepest step (strato.blue) would
  // vanish on a dark card, so dark mode selects a light step of the same hue instead.
  const colors = tone === "hero"
    ? { track: "rgba(255,255,255,0.16)", vested: "rgba(255,255,255,0.55)", claimed: "#FFFFFF", claimedClass: "" }
    : { track: "rgba(52,82,254,0.16)", vested: "#3452FE", claimed: undefined, claimedClass: "stroke-strato-blue dark:stroke-[#a9b8ff]" };

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colors.track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={colors.vested} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={arc(vestedPercent)}
          className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={colors.claimed} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={arc(claimedPercent)}
          className={`transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none ${colors.claimedClass}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
    </div>
  );
};

interface ScheduleProps {
  vesting: VestingView;
  now: number;
}

// The grant's own calendar: start on the left, fully vested on the right, the fill is time served.
// A paused or cancelled grant stops at its freeze date and says so with a marker.
const Schedule = ({ vesting, now }: ScheduleProps) => {
  const started = vesting.status !== "not_started";
  const frozen = vesting.pausingDate > 0;
  const effective = frozen ? vesting.pausingDate : now;
  const span = vesting.endDate - vesting.startDate;
  const elapsedPercent = !started
    ? 0
    : span <= 0 ? 100 : Math.min(100, Math.max(0, ((effective - vesting.startDate) / span) * 100));
  const ended = started && elapsedPercent >= 100 && !frozen;

  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: "rgba(52,82,254,0.16)" }}>
        <div
          className={`absolute left-0 top-0 h-2 rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none ${vesting.cancelled ? "bg-destructive" : "bg-strato-lightblue"}`}
          style={{ width: `${elapsedPercent}%` }}
        />
        {started && !ended && (
          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${elapsedPercent}%` }}
          >
            {vesting.cancelled ? (
              <CircleX className="h-4 w-4 text-destructive bg-card rounded-full" aria-label="Cancelled here" />
            ) : frozen ? (
              <CirclePause className="h-4 w-4 text-yellow-600 bg-card rounded-full" aria-label="Paused here" />
            ) : (
              <span className="block h-4 w-4 rounded-full border-2 border-card bg-strato-lightblue shadow" aria-label="Today" />
            )}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <div>
          <p className="font-medium text-foreground"><LocalDate seconds={vesting.startDate} short /></p>
          <p>{started ? "Started" : "Starts"}</p>
        </div>
        {frozen && !vesting.cancelled && (
          <div className="text-center">
            <p className="font-medium text-yellow-600"><LocalDate seconds={vesting.pausingDate} short /></p>
            <p>Paused</p>
          </div>
        )}
        {vesting.cancelled && (
          <div className="text-center">
            <p className="font-medium text-destructive"><LocalDate seconds={vesting.pausingDate} short /></p>
            <p>Cancelled</p>
          </div>
        )}
        <div className="text-right">
          <p className="font-medium text-foreground">
            <LocalDate seconds={vesting.endDate} prefix={frozen && !vesting.cancelled ? "≥ " : undefined} short />
          </p>
          <p>{vesting.durationWeeks === 0 ? "Vests in full" : "Fully vested"}</p>
        </div>
      </div>
    </div>
  );
};

const Figure = ({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`text-sm font-semibold tabular-nums ${emphasis ? "text-strato-lightblue" : ""}`}>{value}</p>
  </div>
);

// ---- sections ----

interface ProgramHeroProps {
  summary: VestingSummary;
  vestings: VestingView[];
}

// The thesis of the page: how much of the allocation has vested, as one ring and one figure.
const ProgramHero = ({ summary, vestings }: ProgramHeroProps) => {
  const amount = toBigInt(summary.amount);
  const vested = toBigInt(summary.vested);
  const claimed = toBigInt(summary.claimed);
  const vestedPct = percentOf(vested, amount);
  const accruing = vestings.filter((vesting) => vesting.status === "vesting");
  const perDay = accruing.reduce((total, vesting) => total + dailyAccrual(vesting), 0n);
  // Grants with anything left to vest, including ones that have not started or are paused.
  const outstanding = vestings.filter((vesting) => !vesting.cancelled && toBigInt(vesting.locked) > 0n);
  const lastEnd = outstanding.reduce((latest, vesting) => Math.max(latest, vesting.endDate), 0);
  const lastEndIsFloor = outstanding.some((vesting) => vesting.pausingDate > 0);

  return (
    <div className="rounded-2xl overflow-hidden text-white" style={{ background: HERO_GRADIENT }}>
      <div className="flex flex-col gap-8 px-5 py-6 md:px-8 md:py-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="h-[3px] w-7 rounded-full bg-strato-orange" />
            <span className="text-xs font-bold tracking-[0.22em] text-strato-lightblue">STRATO VESTING</span>
          </div>
          <p className="mt-5 text-4xl font-bold leading-none tracking-tight md:text-5xl">
            {formatAmount(summary.amount)}
            <span className="ml-2 text-lg font-semibold text-white/60 md:text-xl">{TOKEN_SYMBOL}</span>
          </p>
          <p className="mt-3 text-sm text-white/60 md:text-base">
            {perDay > 0n
              ? `Vesting ${formatStrato(perDay)} a day. `
              : vestedPct >= 100
                ? "Everything has vested."
                : "Nothing is vesting right now. "}
            {lastEnd > 0 && `Fully vested ${lastEndIsFloor ? "no earlier than" : "by"} ${formatDay(lastEnd)}.`}
          </p>

          <div className="mt-7 flex flex-wrap gap-x-10 gap-y-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-white/50">Claimable now</p>
              <p className="mt-1 text-xl font-semibold text-strato-gold">{formatAmount(summary.claimable)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-white/50">Vested</p>
              <p className="mt-1 text-xl font-semibold">{formatAmount(summary.vested)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-white/50">Claimed</p>
              <p className="mt-1 text-xl font-semibold">{formatAmount(summary.claimed)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-white/50">Unvested</p>
              <p className="mt-1 text-xl font-semibold">{formatAmount(summary.locked)}</p>
            </div>
            {toBigInt(summary.returned) > 0n && (
              <div>
                <p className="text-xs uppercase tracking-wider text-white/50">Returned to pool</p>
                <p className="mt-1 text-xl font-semibold text-white/80">{formatAmount(summary.returned)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5 lg:flex-col lg:gap-3">
          <VestingRing
            claimedPercent={percentOf(claimed, amount)}
            vestedPercent={vestedPct}
            size={168}
            stroke={14}
            tone="hero"
            label={`${vestedPct.toFixed(1)} percent of the allocation has vested`}
          >
            <span className="text-4xl font-bold leading-none">{vestedPct.toFixed(vestedPct >= 100 ? 0 : 1)}%</span>
            <span className="mt-1 text-xs uppercase tracking-wider text-white/60">vested</span>
          </VestingRing>
          <div className="flex flex-col gap-1.5 text-xs text-white/70 lg:flex-row lg:gap-4">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white" />Claimed</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white/55" />Claimable</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "rgba(255,255,255,0.16)" }} />Unvested</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface VestingCardProps {
  vesting: VestingView;
  now: number;
  /** Whether the signed-in identity can pay the claim's network fee right now. */
  canPayFee: boolean;
  onClaim: (vesting: VestingView) => void;
}

const VestingCard = ({ vesting, now, canPayFee, onClaim }: VestingCardProps) => {
  const badge = STATUS_BADGE[vesting.status] ?? STATUS_BADGE.vesting;
  const amount = toBigInt(vesting.amount);
  const percent = vestedPercent(vesting);
  const notStarted = vesting.status === "not_started";
  // Keyed on the flag rather than the status: a pause before the start or after the end keeps
  // its not_started / fully_vested status, but the admin pause is still worth stating.
  const paused = vesting.pausingDate > 0 && !vesting.cancelled;
  // The flag, not the status: a cancelled vesting reads "complete" once its frozen part is claimed.
  const cancelled = vesting.cancelled;
  const claimable = toBigInt(vesting.claimable);
  const badgeLabel = notStarted ? `Starts in ${formatCountdown(vesting.startDate - now)}` : badge.label;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-start gap-5">
          <VestingRing
            claimedPercent={percentOf(toBigInt(vesting.amountClaimed), amount)}
            vestedPercent={percent}
            size={88}
            stroke={9}
            tone="card"
            label={`${percent.toFixed(1)} percent of this grant has vested`}
          >
            <span className="text-lg font-bold leading-none">{percent.toFixed(percent >= 100 ? 0 : 1)}%</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">vested</span>
          </VestingRing>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-2xl font-bold leading-tight tracking-tight">
                {formatAmount(vesting.amount)}
                <span className="ml-1.5 text-sm font-semibold text-muted-foreground">{TOKEN_SYMBOL}</span>
              </p>
              <div className="flex items-center gap-2">
                {vesting.managed && (
                  <Badge variant="outline" className="text-muted-foreground">Managed</Badge>
                )}
                <Badge variant={badge.variant} className={`${badge.className ?? ""} tabular-nums`}>{badgeLabel}</Badge>
              </div>
            </div>
            <p className="mt-2 flex items-center text-xs text-muted-foreground font-mono">
              Grant {truncateHex(vesting.vestingId)}
              <CopyButton address={vesting.vestingId} />
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Schedule vesting={vesting} now={now} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Claimable now" value={formatAmount(vesting.claimable)} emphasis={claimable > 0n} />
          <Figure label="Vested" value={formatAmount(vesting.vested)} />
          <Figure label="Claimed" value={formatAmount(vesting.amountClaimed)} />
          <Figure label="Unvested" value={formatAmount(vesting.locked)} />
        </div>

        {paused && (
          <p className="mt-4 text-xs text-yellow-600">
            Accrual is paused since <LocalDate seconds={vesting.pausingDate} />. The end date moves out by the time paused.
          </p>
        )}
        {cancelled && (
          <p className="mt-4 text-xs text-destructive">
            {toBigInt(vesting.vested) === 0n ? (
              <>Cancelled before it started; the full {formatStrato(vesting.returned)} returned to the pool.</>
            ) : claimable > 0n ? (
              <>Cancelled on <LocalDate seconds={vesting.pausingDate} />; the vested part remains claimable and {formatStrato(vesting.returned)} returned to the pool.</>
            ) : (
              <>Cancelled on <LocalDate seconds={vesting.pausingDate} />; the vested part has been claimed and {formatStrato(vesting.returned)} returned to the pool.</>
            )}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Network fee per claim: <NetworkFee calls={VESTING_CLAIM_CALLS} /></p>
          <Button onClick={() => onClaim(vesting)} disabled={!canClaim(vesting) || !canPayFee} className="min-w-[8rem]">
            Claim
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

interface ClaimDialogProps {
  vesting: VestingView | null;
  recipient: string | null;
  walletSigning: boolean;
  canPayFee: boolean;
  /** Progress text while the claim is in flight; null when idle. */
  progress: string | null;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

// The one irreversible step gets a confirmation: what is claimed, where it goes, what it costs.
// The dialog stays open while the transaction is signed and submitted so the progress is visible.
const ClaimDialog = ({ vesting, recipient, walletSigning, canPayFee, progress, error, onConfirm, onClose }: ClaimDialogProps) => {
  const busy = progress !== null;
  return (
    <Dialog open={vesting !== null} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Claim vested STRATO</DialogTitle>
          <DialogDescription>
            Everything vested on this grant that has not been claimed yet is sent to your address.
          </DialogDescription>
        </DialogHeader>

        {vesting && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">You claim</dt>
            <dd className="text-right font-semibold tabular-nums">{formatStrato(vesting.claimable)}</dd>
            <dt className="text-muted-foreground">Sent to</dt>
            <dd className="text-right font-mono text-xs leading-5">{recipient ? truncateHex(recipient) : "your address"}</dd>
            <dt className="text-muted-foreground">Grant</dt>
            <dd className="text-right font-mono text-xs leading-5">{truncateHex(vesting.vestingId)}</dd>
            <dt className="text-muted-foreground">Network fee</dt>
            <dd className="text-right tabular-nums"><NetworkFee calls={VESTING_CLAIM_CALLS} /></dd>
          </dl>
        )}

        <FeeNotices calls={VESTING_CLAIM_CALLS} />

        {walletSigning && !busy && !error && (
          <p className="text-xs text-muted-foreground">Your wallet will ask you to sign the transaction.</p>
        )}
        {progress && (
          <p className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={onConfirm} disabled={busy || !vesting || !canPayFee}>
            {busy ? "Claiming…" : "Claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const EmptyState = () => (
  <Card>
    <CardContent className="p-8 text-center">
      <p className="text-base font-semibold">No vesting grants for this address</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Grants are tied to one account. Sign in or connect the wallet that holds a grant to see its schedule and claim.
      </p>
    </CardContent>
  </Card>
);

const ErrorState = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <Card>
    <CardContent className="p-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Could not load vestings</p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </CardContent>
  </Card>
);

const LoadingState = () => (
  <>
    <div className="rounded-2xl p-6 md:p-8" style={{ background: HERO_GRADIENT }}>
      <Skeleton className="h-3 w-32 bg-white/10" />
      <Skeleton className="mt-5 h-12 w-64 bg-white/10" />
      <div className="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 bg-white/10" />)}
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-5">
              <Skeleton className="h-[88px] w-[88px] rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-2 w-full" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-10" />)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  </>
);

// ---- page ----

const Vesting = () => {
  const { userAddress, isAppAuthenticated, isExternalWalletConnected } = useUser();
  const { fetchTokens } = useUserTokens();
  const { feeQuote } = useTokenContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { vestings, summary, enabled, isLoading, isError, error, refetch } = useVestings();
  const [claimTarget, setClaimTarget] = useState<VestingView | null>(null);
  const [claimProgress, setClaimProgress] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const startedRefetchRef = useRef<Set<string>>(new Set());

  usePageTitle("Vesting");

  // A claim must come from the identity the rows were looked up for: a vault session signs
  // server-side, a wallet-only guest signs the unsigned tx in the wallet. isExternalWalletConnected
  // is UserContext's view of the wagmi isConnected that EarnStaking reads directly.
  const useExternalWalletSigning = isExternalWalletConnected && !isAppAuthenticated;
  // Same gate as the staking actions: no quote yet, or a shortfall the fallback cannot cover, disables Claim.
  const canPayFee = !!feeQuote && !feeShortfall(feeQuote, VESTING_CLAIM_CALLS);

  // The schedule markers and countdowns move with the clock; one tick a minute is plenty for
  // the markers, and every second only while a countdown is on screen.
  const hasPending = vestings.some((vesting) => vesting.status === "not_started");
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), hasPending ? 1000 : 60000);
    return () => clearInterval(id);
  }, [hasPending]);

  // A countdown that reaches zero only changes status on the next fetch; pull it once per vesting.
  useEffect(() => {
    const crossed = vestings.filter(
      (vesting) => vesting.status === "not_started" && vesting.startDate <= now && !startedRefetchRef.current.has(vesting.vestingId)
    );
    if (crossed.length === 0) return;
    crossed.forEach((vesting) => startedRefetchRef.current.add(vesting.vestingId));
    refetch();
  }, [vestings, now, refetch]);

  const openClaim = (vesting: VestingView) => {
    setClaimError(null);
    setClaimProgress(null);
    setClaimTarget(vesting);
  };

  const closeClaim = () => {
    setClaimTarget(null);
    setClaimError(null);
    setClaimProgress(null);
  };

  const confirmClaim = async () => {
    if (!claimTarget) return;
    const { vestingId } = claimTarget;
    const claimedLabel = formatStrato(claimTarget.claimable);
    setClaimError(null);
    setClaimProgress(useExternalWalletSigning ? "Preparing the transaction…" : "Submitting the transaction…");

    const walletTxProgress: WalletTxProgressHandler = (event) => setClaimProgress(progressLabel(event));
    const txConfig: ClaimTxConfig | undefined = useExternalWalletSigning ? { walletAuth: true, walletTxProgress } : undefined;

    try {
      await api.post("/vesting/claim", { vestingId }, txConfig);
      toast({ title: "Claimed", description: `${claimedLabel} sent to your address`, variant: "success" });
      closeClaim();
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: vestingsQueryKey(userAddress) });
        fetchTokens();
      }, CIRRUS_LAG_MS);
    } catch (failure: unknown) {
      const message = claimErrorMessage(failure);
      setClaimProgress(null);
      setClaimError(message);
      toast({ title: "Claim failed", description: message, variant: "destructive" });
    }
  };

  const renderContent = () => {
    if (!enabled) return <EmptyState />;
    if (isLoading) return <LoadingState />;
    if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;
    if (vestings.length === 0) return <EmptyState />;
    return (
      <>
        <ProgramHero summary={summary ?? sumVestings(vestings)} vestings={vestings} />
        <div className="grid gap-4 lg:grid-cols-2">
          {vestings.map((vesting) => (
            <VestingCard key={vesting.vestingId} vesting={vesting} now={now} canPayFee={canPayFee} onClaim={openClaim} />
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Vesting" subtitle="Your STRATO vesting grants and claims" />

        <main className="p-4 md:p-6">
          <div className="space-y-6">{renderContent()}</div>
        </main>
      </div>

      <ClaimDialog
        vesting={claimTarget}
        recipient={userAddress}
        walletSigning={useExternalWalletSigning}
        canPayFee={canPayFee}
        progress={claimProgress}
        error={claimError}
        onConfirm={confirmClaim}
        onClose={closeClaim}
      />
      <MobileBottomNav />
    </div>
  );
};

export default Vesting;
