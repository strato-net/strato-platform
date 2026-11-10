import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { parseUnits, formatUnits } from "viem";
import {
  Users,
  Plus,
  X,
  ShieldCheck,
  AlertTriangle,
  Check,
  Clock,
  Vote,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/CopyButton";
import { AddressInput } from "@/components/AddressInput";
import { AddrLink } from "@/components/explorer/AddrLink";
import { shortenHex } from "@/lib/utils";
import { useUser } from "@/context/UserContext";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { formatVariadicArg, parseArgText, typedVariadicArg, variadicArgValue } from "@/lib/args";
import {
  useMyTokens,
  useTokenAllowances,
  useTokenAllowanceRequirements,
  type TokenAllowanceRequirement,
  type TokenBalance,
} from "@/services/tokens";
import {
  useCDPMetadata,
  useDeployedPositions,
  usePoolMetadata,
  useStakingMetadata,
  type CDPMetadata,
  type PoolMetadata,
  type StakingMetadata,
} from "@/services/protocolMetadata";
import { useContractGroups, useContractInfo, functionArgs, fetchFunctionArgs } from "@/services/contracts";
import { useSimulation } from "@/components/simulation/useSimulation";
import { SimulateButton } from "@/components/simulation/SimulateButton";
import { SimulationResultPanel } from "@/components/simulation/SimulationResultPanel";
import type { UserWallet } from "@/services/userWallets";
import {
  useIsMultisig,
  useSigners,
  usePendingSigners,
  useVotingThresholds,
  useOpenIssues,
  useExecutedIssues,
  useMultisigActions,
  useParentMultisigs,
  buildNestedCastVotePayload,
  multisigDisplayName,
  votesNeeded,
  strip0x,
  MAX_TIMELOCK_DELAY,
  buildProtocolWorkflowCalls,
  type ProtocolActionKind,
  type OpenIssue,
} from "@/services/multisig";

/* --------------------------------------------------------------------------------- */
/* Helpers                                                                            */
/* --------------------------------------------------------------------------------- */

const eq = (a?: string, b?: string) => !!a && !!b && strip0x(a) === strip0x(b);

const isZeroAddress = (address?: string) => !address || /^0*$/.test(strip0x(address));

const isAddressLike = (s: string) => /^(0x)?[0-9a-fA-F]{40}$/.test(s.trim());

/** A bare address/account parameter (not an array of them). */
const isPlainAddressType = (t: string) => /^(address|account)$/i.test(t.trim());

const PERCENTS = [25, 50, 75, 100] as const;

/** Balance of a token as a human-readable decimal string. */
function humanBalance(t: TokenBalance): string {
  return safeFormatUnits(t.balance, t.decimals);
}

/** A duration in seconds as "2d 4h", "3h 20m", "45m" or "30s". */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${m}m` : `${s}s`;
}

/** Human-readable label + canonical args for a governance issue's function. */
function describeIssue(func: string, args: string[]): { label: string; canonical: string[] } {
  const a0 = args[0] ?? "";
  switch (func) {
    case "_addAdmin":
      return { label: `Add signer ${shortenHex(a0, 6, 4)}`, canonical: [strip0x(a0)] };
    case "_removeAdmin":
      return { label: `Remove signer ${shortenHex(a0, 6, 4)}`, canonical: [strip0x(a0)] };
    case "_swapAdmin":
      return {
        label: `Swap signer ${shortenHex(a0, 6, 4)} → ${shortenHex(args[1] ?? "", 6, 4)}`,
        canonical: [strip0x(a0), strip0x(args[1] ?? "")],
      };
    case "_proposeAdmin": {
      const replacement = args[1] ?? "";
      return isZeroAddress(a0)
        ? { label: `Nominate signer ${shortenHex(replacement, 6, 4)}`, canonical: [strip0x(a0), strip0x(replacement)] }
        : {
            label: `Nominate replacement ${shortenHex(a0, 6, 4)} → ${shortenHex(replacement, 6, 4)}`,
            canonical: [strip0x(a0), strip0x(replacement)],
          };
    }
    case "setDefaultVotingThresholdBps":
      // Label is rendered as "M of N" by labelForIssue (needs the signer count).
      return { label: "Set approval threshold", canonical: [String(Number(a0) || 0)] };
    case "setTimelockDelay": {
      const seconds = Number(a0) || 0;
      return {
        label: seconds ? `Set timelock delay to ${formatDuration(seconds)}` : "Turn off the timelock",
        canonical: [String(seconds)],
      };
    }
    case "cancelIssue":
      return { label: `Cancel queued issue ${shortenHex(a0, 8, 6)}`, canonical: [a0] };
    case "transferOwnership":
      return { label: `Transfer ownership → ${shortenHex(a0, 6, 4)}`, canonical: [strip0x(a0)] };
    case "setLogicContract":
      return { label: `Set logic contract → ${shortenHex(a0, 6, 4)}`, canonical: [strip0x(a0)] };
    case "transfer":
      return {
        label: `Transfer → ${shortenHex(a0, 6, 4)}`,
        canonical: [strip0x(a0), String(args[1] ?? "0")],
      };
    case "callContract":
      return { label: `Call ${shortenHex(a0, 6, 4)}·${args[1] ?? ""}`, canonical: args };
    case "castVoteOnIssue": {
      // A vote wrapped for another multisig: args = [target, func, …inner args].
      const inner = describeIssue(args[1] ?? "", args.slice(2));
      return {
        label: `Vote in ${shortenHex(a0, 6, 4)}: ${inner.label}`,
        canonical: [strip0x(a0), args[1] ?? "", ...inner.canonical],
      };
    }
    default:
      return { label: func || "(unknown)", canonical: args };
  }
}

const KNOWN_ISSUE_ARG_TYPES: Record<string, string[]> = {
  _proposeAdmin: ["address", "address"],
  _removeAdmin: ["address"],
  approve: ["address", "uint256"],
  transfer: ["address", "uint256"],
  setDefaultVotingThresholdBps: ["uint256"],
  setTimelockDelay: ["uint256"],
  setLogicContract: ["address"],
  transferOwnership: ["address"],
  cancelIssue: ["string"],
};

/** Rebuild the typed variadic values needed to reproduce an issue's exact hash. */
async function typedIssueArgs(target: string, func: string, args: string[]): Promise<unknown[]> {
  if (func === "castVoteOnIssue" && args.length >= 2) {
    const innerTarget = strip0x(args[0] ?? "");
    const innerFunc = args[1] ?? "";
    return [
      typedVariadicArg("address", innerTarget),
      typedVariadicArg("string", innerFunc),
      ...await typedIssueArgs(innerTarget, innerFunc, args.slice(2)),
    ];
  }

  const { canonical } = describeIssue(func, args);
  let types = KNOWN_ISSUE_ARG_TYPES[func] ?? [];
  try {
    const declared = await fetchFunctionArgs(target, func);
    if (declared.length === canonical.length && declared.every((arg) => arg.type)) {
      types = declared.map((arg) => arg.type);
    }
  } catch {
    // Known functions retain their fixed types; unknown calls use their event values.
  }
  if (types.length !== canonical.length) return canonical;
  return canonical.map((value, index) => typedVariadicArg(types[index], value));
}

/** Short display name for a hop in a nested-vote route. */
function hopName(w: UserWallet): string {
  return multisigDisplayName(w) || shortenHex(w.address, 4, 4);
}

/**
 * Panel headings for the simulated effect chain of a vote travelling `route`
 * (ending at the wallet whose issue is voted on): one heading per intermediate
 * vote hop, then one for the ultimate issue's action. When the issue itself is
 * a wrapped vote (castVoteOnIssue), each wrapper layer adds another hop.
 */
function effectChainTitles(route: UserWallet[], issueFunc?: string, issueArgs?: unknown[]): string[] {
  const titles: string[] = [];
  for (let i = 1; i < route.length; i++) {
    titles.push(`Vote by ${hopName(route[i - 1])} in ${hopName(route[i])}`);
  }
  let prev = hopName(route[route.length - 1]);
  let f = issueFunc ?? "";
  let a = issueArgs ?? [];
  while (f === "castVoteOnIssue" && a.length >= 2) {
    const next = shortenHex(String(variadicArgValue(a[0]) ?? ""), 4, 4);
    titles.push(`Vote by ${prev} in ${next}`);
    prev = next;
    f = String(variadicArgValue(a[1]) ?? "");
    a = a.slice(2);
  }
  titles.push(titles.length > 0 ? "Final effect (if every threshold passes)" : "Effect if executed");
  return titles;
}

type TokenMeta = { symbol: string; decimals: number };

/** Map token contract address → metadata, from a set of balances. */
function useTokenMeta(address?: string | null): Map<string, TokenMeta> {
  const { data } = useMyTokens(address);
  return useMemo(() => {
    const m = new Map<string, TokenMeta>();
    for (const t of data ?? []) m.set(strip0x(t.address), { symbol: t.symbol, decimals: t.decimals });
    return m;
  }, [data]);
}

function safeFormatUnits(raw: string, decimals: number): string {
  try {
    return formatUnits(BigInt(raw), decimals);
  } catch {
    return raw;
  }
}

function isPositiveRaw(raw?: string): boolean {
  try {
    return BigInt(raw ?? "0") > 0n;
  } catch {
    return false;
  }
}

/**
 * Convert an "M of N" approval to basis points: the largest bps whose votesNeeded is
 * exactly M under the contract rule `10000*votes >= bps*N`. 2-of-2 → 10000, 2-of-3 →
 * 6666, 1-of-3 → 3333.
 */
function mOfNToBps(m: number, n: number): number {
  if (n <= 0) return 10000;
  return Math.max(1, Math.min(10000, Math.floor((m * 10000) / n)));
}

/** Human label for an issue: `transfer` amounts and threshold changes get formatted. */
function labelForIssue(
  issue: { func: string; target: string; args: string[] },
  tokenMeta: Map<string, TokenMeta>,
  signerCount: number
): string {
  if (issue.func === "transfer") {
    const meta = tokenMeta.get(strip0x(issue.target));
    const to = issue.args[0] ?? "";
    const raw = issue.args[1] ?? "0";
    const amt = meta ? safeFormatUnits(raw, meta.decimals) : raw;
    const sym = meta?.symbol ?? shortenHex(issue.target, 5, 4);
    return `Transfer ${amt} ${sym} → ${shortenHex(to, 6, 4)}`;
  }
  if (issue.func === "setDefaultVotingThresholdBps") {
    const bps = Number(issue.args[0]) || 0;
    return `Set approval to ${votesNeeded(signerCount, bps)} of ${signerCount}`;
  }
  return describeIssue(issue.func, issue.args).label;
}

/* --------------------------------------------------------------------------------- */
/* Dialog shell                                                                       */
/* --------------------------------------------------------------------------------- */

export function MultisigDialog({
  wallet,
  route,
}: {
  wallet: UserWallet;
  /**
   * Nested-membership route ending at `wallet` (from useNestedMultisigs): the
   * connected account signs route[0] directly and each hop is a signer on the
   * next. When present, votes in this dialog travel the route as wrapped
   * castVoteOnIssue issues instead of being cast directly.
   */
  route?: UserWallet[];
}) {
  const [open, setOpen] = useState(false);
  const { isMultisig, fullyEnabled, isLoading } = useIsMultisig(open ? wallet.address : null);
  const nested = !!route && route.length > 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Multisig
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Multisig — {multisigDisplayName(wallet) || "User"}
            {fullyEnabled ? (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" /> Enabled
              </Badge>
            ) : null}
            {nested ? (
              <Badge variant="outline" className="gap-1">
                Nested
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {nested
              ? `You vote here through your membership chain: you → ${route!
                  .map(hopName)
                  .join(" → ")}. Each multisig on the way must pass its own vote.`
              : "Turn this User wallet into a Safe-style multisig governed by signer votes."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading wallet state…</p>
        ) : fullyEnabled || (nested && isMultisig) ? (
          <EnabledView wallet={wallet} route={nested ? route : undefined} />
        ) : nested ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This multisig isn't fully enabled yet, so nested voting is unavailable.
          </p>
        ) : (
          <EnablePanel wallet={wallet} partiallyEnabled={isMultisig} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------------------------- */
/* Enable panel                                                                       */
/* --------------------------------------------------------------------------------- */

function EnablePanel({
  wallet,
  partiallyEnabled,
}: {
  wallet: UserWallet;
  partiallyEnabled: boolean;
}) {
  const { userAddress } = useUser();
  const { canSubmit, isAppAuthenticated } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { config, selfOwned, initialized } = useIsMultisig(wallet.address);
  const { ensureMultisigLogic, enableMultisig } = useMultisigActions({ walletAddress: wallet.address });

  const me = strip0x(userAddress ?? "");
  const [extra, setExtra] = useState<{ text: string; addr: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const logicSet = config.runsMultisigLogic;
  const initialSigners = Array.from(new Set([me, ...extra.map((e) => e.addr)].filter(Boolean)));
  const hasMinimumSigners = initialized || initialSigners.length >= 3;

  const run = async () => {
    if (!me) {
      toast.error("Connect a wallet first");
      return;
    }
    const unresolved = extra.find((e) => e.text.trim() && !e.addr);
    if (unresolved) {
      toast.error("Unresolved signer", {
        description: `"${unresolved.text}" is not a valid address or known username.`,
      });
      return;
    }
    if (!initialized && initialSigners.length < 3) {
      toast.error("At least three signers are required");
      return;
    }
    setBusy(true);
    try {
      const logic = logicSet
        ? config.logicContract
        : await ensureMultisigLogic(isAppAuthenticated ? undefined : wallet.username);
      await enableMultisig(logic, initialSigners, { logicSet, initialized, selfOwned });
      queryClient.invalidateQueries({ queryKey: ["multisig-config", wallet.address] });
      queryClient.invalidateQueries({ queryKey: ["multisig-signers", wallet.address] });
      toast.success("Multisig enabled", {
        description: "The wallet now owns itself and is governed by signer votes.",
      });
    } catch (err: any) {
      toast.error("Enable failed", { description: String(err?.message || err) });
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  return (
    <div className="space-y-5">
      {partiallyEnabled ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Finish enabling</AlertTitle>
          <AlertDescription>
            This wallet already delegates to multisig logic but isn't fully locked yet.
            Running the remaining steps below will complete setup.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Enabling multisig runs up to three transactions on this wallet:</p>
        <ol className="ml-4 list-decimal space-y-1">
          <li className={logicSet ? "line-through" : ""}>
            Point the wallet's logic contract at the Multisig logic (deployed first if this
            network doesn't have it yet).
          </li>
          <li className={initialized ? "line-through" : ""}>Set the initial signer(s).</li>
          <li className={selfOwned ? "line-through" : ""}>
            Transfer the wallet's ownership to itself.
          </li>
        </ol>
      </div>

      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>You give up unilateral control</AlertTitle>
        <AlertDescription>
          After the wallet owns itself, you can no longer act as its owner directly — every
          action (sending funds, adding/removing signers, changing the threshold) becomes a
          signer vote. Make sure you're in the signer list below. This is reversible later by
          a signer vote.
        </AlertDescription>
      </Alert>

      {!initialized ? (
        <div className="space-y-2">
          <Label>Initial signers</Label>
          <div className="flex items-center gap-2">
            <Input value={me} readOnly className="font-mono text-xs" />
            <Badge variant="secondary" className="shrink-0">
              You
            </Badge>
          </div>
          {extra.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <AddressInput
                value={a.text}
                resolved={a.addr}
                onChange={(text, addr) =>
                  setExtra((prev) => prev.map((x, idx) => (idx === i ? { text, addr } : x)))
                }
                placeholder="0x… address or username"
                className="font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExtra((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove signer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExtra((prev) => [...prev, { text: "", addr: "" }])}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add signer
          </Button>
          <p className="text-xs text-muted-foreground">
            At least three signers are required. By default, 2 of 3 signers approve each action;
            the threshold can never require every signer.
          </p>
        </div>
      ) : null}

      <Button
        onClick={run}
        disabled={busy || !canSubmit || !me || !hasMinimumSigners}
        className="w-full"
      >
        {busy ? step || "Working…" : partiallyEnabled ? "Finish enabling" : "Enable multisig"}
      </Button>
      {!canSubmit ? (
        <p className="text-xs text-muted-foreground">Connect a wallet to enable multisig.</p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* Enabled view                                                                       */
/* --------------------------------------------------------------------------------- */

function EnabledView({ wallet, route }: { wallet: UserWallet; route?: UserWallet[] }) {
  // Normalized voting route: always ends at this wallet; a single entry means
  // the connected account votes here directly.
  const fullRoute = useMemo(
    () => (route && route.length > 1 ? route : [wallet]),
    [route, wallet]
  );
  return (
    <>
      <UpgradeLogicPanel wallet={wallet} fullRoute={fullRoute} />
      <MemberOfPanel fullRoute={fullRoute} />
      <Tabs defaultValue={fullRoute.length > 1 ? "issues" : "treasury"} className="mt-1">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="treasury">Treasury</TabsTrigger>
        <TabsTrigger value="actions">Actions</TabsTrigger>
        <TabsTrigger value="signers">Signers</TabsTrigger>
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="treasury" className="mt-4">
        <TreasuryTab wallet={wallet} fullRoute={fullRoute} />
      </TabsContent>
      <TabsContent value="actions" className="mt-4">
        <ProtocolActionsTab wallet={wallet} fullRoute={fullRoute} />
      </TabsContent>
      <TabsContent value="signers" className="mt-4">
        <SignersTab wallet={wallet} fullRoute={fullRoute} />
      </TabsContent>
      <TabsContent value="issues" className="mt-4">
        <IssuesTab wallet={wallet} fullRoute={fullRoute} />
      </TabsContent>
      <TabsContent value="history" className="mt-4">
        <HistoryTab wallet={wallet} />
      </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * Wallets whose logic does not match the current Multisig source can vote to upgrade;
 * signers, threshold and funds stay. Registries without a username (the global 0x100c)
 * keep their logic.
 */
function UpgradeLogicPanel({ wallet, fullRoute }: { wallet: UserWallet; fullRoute: UserWallet[] }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { config, isLoading } = useIsMultisig(wallet.address);
  const { data: signers = [] } = useSigners(wallet.address);
  const { ensureMultisigLogic, castVote } = useMultisigActions({
    walletAddress: wallet.address,
    route: fullRoute.map((w) => w.address),
  });
  const [busy, setBusy] = useState(false);
  const canVote = fullRoute.length > 1 || signers.some((s) => eq(s, userAddress ?? ""));
  const thresholdBps = config.defaultThresholdBps || 6000;
  const requiredVotes = votesNeeded(signers.length, thresholdBps);
  const migrationSafe = signers.length >= 3 && requiredVotes <= signers.length - 1;
  if (!wallet.username || isLoading || config.runsMultisigLogic || !canVote) return null;

  const propose = async () => {
    if (!migrationSafe) {
      toast.error("Unsafe multisig configuration", {
        description: "Repair the signer count or approval threshold under the current logic before upgrading.",
      });
      return;
    }
    setBusy(true);
    try {
      await castVote("setLogicContract", [await ensureMultisigLogic()]);
      queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
      toast.success("Upgrade proposed", {
        description: "It runs once enough signers vote for it under Issues.",
      });
    } catch (err: any) {
      toast.error("Upgrade proposal failed", { description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Alert className="mb-3">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Older multisig logic</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          This wallet runs an earlier governance logic version. AdminRegistry-based versions can
          count votes from replaced signers and let whitelisted accounts act without a vote.
          Switching to the current Multisig logic keeps its signers, threshold and funds.
        </p>
        <p>
          Resulting configuration: {requiredVotes} of {signers.length} approvals.
        </p>
        {!migrationSafe && (
          <p className="font-medium text-destructive">
            {signers.length < 3
              ? `Add at least ${3 - signers.length} more signer${3 - signers.length === 1 ? "" : "s"} under the current logic before upgrading.`
              : `Lower the approval requirement to at most ${signers.length - 1} of ${signers.length} under the current logic before upgrading.`}
          </p>
        )}
        <Button size="sm" onClick={propose} disabled={busy || !canSubmit || !migrationSafe}>
          {busy ? "Proposing…" : "Propose upgrade"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Multisigs this wallet is itself a signer on. Each row opens the parent's
 * dialog with the membership route extended by one hop, so votes cast there
 * travel through this wallet (this wallet's vote, not your personal one).
 */
function MemberOfPanel({ fullRoute }: { fullRoute: UserWallet[] }) {
  const wallet = fullRoute[fullRoute.length - 1];
  const { data: parents = [] } = useParentMultisigs(wallet.address);
  // Don't offer hops back into the current route (mutual memberships).
  const usable = parents.filter((p) => !fullRoute.some((w) => eq(w.address, p.address)));
  if (usable.length === 0) return null;
  return (
    <div className="mb-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        Signer on other multisigs
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        This multisig's vote counts in the multisigs below. Open one to vote there through{" "}
        {hopName(wallet)} — that casts {hopName(wallet)}'s vote, not your personal one.
      </p>
      <div className="mt-2 space-y-1.5">
        {usable.map((p) => (
          <div
            key={p.address}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
          >
            <span className="text-sm font-medium">
              {multisigDisplayName(p) || shortenHex(p.address, 6, 4)}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {shortenHex(p.address, 6, 4)}
            </span>
            <div className="ml-auto">
              <MultisigDialog wallet={p} route={[...fullRoute, p]} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* Signers tab                                                                        */
/* --------------------------------------------------------------------------------- */

function SignersTab({ wallet, fullRoute }: { wallet: UserWallet; fullRoute: UserWallet[] }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { config } = useIsMultisig(wallet.address);
  const { data: signers = [] } = useSigners(wallet.address);
  const { data: pendingSigners = [] } = usePendingSigners(wallet.address);
  const nested = fullRoute.length > 1;
  const { addSigner, removeSigner, swapSigner, acceptSigner, setDefaultThreshold, setTimelockDelay } = useMultisigActions({
    walletAddress: wallet.address,
    route: fullRoute.map((w) => w.address),
  });

  const me = strip0x(userAddress ?? "");
  const iAmSigner = signers.some((s) => eq(s, me));
  // A nested member proposes/votes through their membership chain.
  const canVote = iAmSigner || nested;
  const signerCount = signers.length;
  const needed = votesNeeded(signerCount, config.defaultThresholdBps || 6000);

  const [newSigner, setNewSigner] = useState("");
  const [newSignerAddr, setNewSignerAddr] = useState("");
  const [replaceSigner, setReplaceSigner] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replacementAddr, setReplacementAddr] = useState("");
  const [targetM, setTargetM] = useState<number | null>(null);
  const [delayHours, setDelayHours] = useState("");
  const [busy, setBusy] = useState<string>("");

  const maxSafeM = Math.max(1, signerCount - 1);
  const selectedM = Math.min(Math.max(targetM ?? needed, 1), maxSafeM);
  const addNeeded = votesNeeded(signerCount + 1, config.defaultThresholdBps || 6000);
  const removeNeeded = votesNeeded(Math.max(0, signerCount - 1), config.defaultThresholdBps || 6000);
  const canRemove = signerCount > 3 && removeNeeded <= signerCount - 2;
  const delaySeconds = delayHours.trim() === "" ? null : Math.round(Number(delayHours) * 3600);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["multisig-signers", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-config", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-pending-signers", wallet.address] });
  };

  const guard = () => {
    if (!canVote) {
      toast.error("Only a signer (or nested member) can propose changes");
      return false;
    }
    return true;
  };

  const doAdd = async () => {
    if (!guard()) return;
    if (strip0x(newSignerAddr).length !== 40) {
      toast.error("Enter a valid address or username");
      return;
    }
    if (signers.some((s) => eq(s, newSignerAddr))) {
      toast.error("Already a signer");
      return;
    }
    setBusy("add");
    try {
      await addSigner(newSignerAddr);
      toast.success("Vote cast to nominate signer", {
        description: "After approval, the nominee must accept before becoming a signer.",
      });
      setNewSigner("");
      setNewSignerAddr("");
      invalidate();
    } catch (err: any) {
      toast.error("Failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const doRemove = async (addr: string) => {
    if (!guard()) return;
    if (!canRemove) {
      toast.error("Removal would violate signer safety");
      return;
    }
    setBusy(addr);
    try {
      await removeSigner(addr);
      toast.success("Vote cast to remove signer", {
        description: "Executes once the threshold is met.",
      });
      invalidate();
    } catch (err: any) {
      toast.error("Failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const doSwap = async () => {
    if (!guard()) return;
    if (!replaceSigner || strip0x(replacementAddr).length !== 40) {
      toast.error("Choose a signer and enter a valid replacement");
      return;
    }
    if (signers.some((s) => eq(s, replacementAddr))) {
      toast.error("Replacement is already a signer");
      return;
    }
    setBusy("swap");
    try {
      await swapSigner(replaceSigner, replacementAddr);
      toast.success("Vote cast to nominate replacement", {
        description: "After approval, the replacement must accept before the atomic swap.",
      });
      setReplaceSigner("");
      setReplacement("");
      setReplacementAddr("");
      invalidate();
    } catch (err: any) {
      toast.error("Failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const doAccept = async () => {
    setBusy("accept");
    try {
      await acceptSigner();
      toast.success("Signer role accepted");
      invalidate();
    } catch (err: any) {
      toast.error("Acceptance failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const doThreshold = async () => {
    if (!guard()) return;
    if (signerCount === 0) return;
    const bps = mOfNToBps(selectedM, signerCount);
    setBusy("threshold");
    try {
      await setDefaultThreshold(bps);
      toast.success("Vote cast to change approval", {
        description: `Proposing ${selectedM} of ${signerCount}. Executes once the threshold is met.`,
      });
      setTargetM(null);
      invalidate();
    } catch (err: any) {
      toast.error("Failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const doDelay = async () => {
    if (!guard() || delaySeconds === null) return;
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > MAX_TIMELOCK_DELAY) {
      toast.error(`The delay must be between 0 and ${MAX_TIMELOCK_DELAY / 3600} hours`);
      return;
    }
    setBusy("delay");
    try {
      await setTimelockDelay(delaySeconds);
      toast.success("Vote cast to change the timelock", {
        description: `Proposing ${delaySeconds ? formatDuration(delaySeconds) : "no delay"}. Takes effect once the threshold is met${config.timelockDelay ? " and the current delay is up" : ""}.`,
      });
      setDelayHours("");
      invalidate();
    } catch (err: any) {
      toast.error("Failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-5">
      {!iAmSigner && nested ? (
        <Alert>
          <Users className="h-4 w-4" />
          <AlertDescription>
            You aren't a direct signer here. Proposals you make travel through{" "}
            {fullRoute.slice(0, -1).map(hopName).join(" → ")} and land here once each
            multisig on the way passes its own vote.
          </AlertDescription>
        </Alert>
      ) : !iAmSigner ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Your connected account isn't a signer on this wallet, so you can view but not vote.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Approval threshold */}
      <div className="rounded-lg border border-border p-3">
        <div className="text-sm font-medium">Approval threshold</div>
        <div className="text-xs text-muted-foreground">
          {needed} of {signerCount} signer{signerCount === 1 ? "" : "s"} must approve each action
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Select value={String(selectedM)} onValueChange={(v) => setTargetM(Number(v))}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: maxSafeM }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">of {signerCount}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={doThreshold}
            disabled={busy !== "" || !canSubmit || !canVote || selectedM === needed}
            className="ml-auto"
          >
            {busy === "threshold" ? "Voting…" : "Propose change"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Result: {selectedM} of {signerCount}. At least one signer always remains optional.
        </p>
      </div>

      {/* Timelock delay: only the Multisig logic has one */}
      {config.runsMultisigLogic ? (
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-medium">Timelock</div>
          <div className="text-xs text-muted-foreground">
            {config.timelockDelay
              ? `Passed issues wait ${formatDuration(config.timelockDelay)} before anyone can execute them; signers can vote to cancel them meanwhile`
              : "Off: passed issues execute at once"}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={MAX_TIMELOCK_DELAY / 3600}
              step="any"
              value={delayHours}
              onChange={(e) => setDelayHours(e.target.value)}
              placeholder={String(config.timelockDelay / 3600)}
              aria-label="Timelock delay in hours"
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">hours</span>
            <Button
              size="sm"
              variant="outline"
              onClick={doDelay}
              disabled={busy !== "" || !canSubmit || !canVote || delaySeconds === null || delaySeconds === config.timelockDelay}
              className="ml-auto"
            >
              {busy === "delay" ? "Voting…" : "Propose change"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Signer list */}
      <div className="space-y-2">
        <Label>Signers ({signers.length})</Label>
        <div className="space-y-1.5">
          {signers.map((s) => (
            <div
              key={s}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                <AddrLink address={s} />
                <CopyButton value={s} />
              </span>
              {eq(s, me) ? (
                <Badge variant="secondary" className="shrink-0">
                  You
                </Badge>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReplaceSigner(s)}
                disabled={busy !== "" || !canSubmit || !canVote}
                className="ml-auto"
              >
                Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => doRemove(s)}
                disabled={busy !== "" || !canSubmit || !canVote || !canRemove}
                className="text-destructive hover:text-destructive"
              >
                {busy === s ? "Voting…" : "Remove"}
              </Button>
            </div>
          ))}
          {signers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signers found.</p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Removing produces {removeNeeded} of {Math.max(0, signerCount - 1)} and is blocked when it
          would leave fewer than three signers or require every remaining signer.
        </p>
      </div>

      {/* Replace signer atomically */}
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label>Replace a signer</Label>
        <Select value={replaceSigner} onValueChange={setReplaceSigner}>
          <SelectTrigger>
            <SelectValue placeholder="Signer to replace" />
          </SelectTrigger>
          <SelectContent>
            {signers.map((signer) => (
              <SelectItem key={signer} value={signer}>
                {shortenHex(signer, 8, 6)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AddressInput
          value={replacement}
          resolved={replacementAddr}
          onChange={(text, addr) => {
            setReplacement(text);
            setReplacementAddr(addr);
          }}
          placeholder="Replacement address or username"
          className="font-mono text-xs"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Result: {needed} of {signerCount}. The old signer remains active until the replacement accepts.
          </p>
          <Button
            size="sm"
            onClick={doSwap}
            disabled={busy !== "" || !canSubmit || !canVote || !replaceSigner || !replacement.trim()}
          >
            {busy === "swap" ? "Voting…" : "Propose replacement"}
          </Button>
        </div>
      </div>

      {/* Add signer */}
      <div className="space-y-2">
        <Label htmlFor="new-signer">Add a signer</Label>
        <div className="flex items-start gap-2">
          <AddressInput
            id="new-signer"
            value={newSigner}
            resolved={newSignerAddr}
            onChange={(text, addr) => {
              setNewSigner(text);
              setNewSignerAddr(addr);
            }}
            placeholder="0x… address or username"
            className="font-mono text-xs"
          />
          <Button onClick={doAdd} disabled={busy !== "" || !canSubmit || !canVote || !newSigner.trim()}>
            {busy === "add" ? "Voting…" : "Propose"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Result after acceptance: {addNeeded} of {signerCount + 1}. The nominee must prove control
          by accepting before the signer set changes.
        </p>
      </div>

      {pendingSigners.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label>Awaiting signer acceptance</Label>
          {pendingSigners.map((pending) => {
            const replacing = !isZeroAddress(pending.adminToReplace);
            const mine = eq(pending.newAdmin, me);
            return (
              <div key={pending.newAdmin} className="flex items-center gap-2 text-xs">
                <span>
                  {replacing ? `Replace ${shortenHex(pending.adminToReplace, 6, 4)} with ` : "Add "}
                  <span className="font-mono">{shortenHex(pending.newAdmin, 6, 4)}</span>
                </span>
                {mine ? (
                  <Button
                    size="sm"
                    onClick={doAccept}
                    disabled={busy !== "" || !canSubmit}
                    className="ml-auto"
                  >
                    {busy === "accept" ? "Accepting…" : "Accept signer role"}
                  </Button>
                ) : (
                  <Badge variant="outline" className="ml-auto">Waiting</Badge>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* Issues tab                                                                         */
/* --------------------------------------------------------------------------------- */

function issueAllowanceRequirements(
  issue: OpenIssue,
  ownerAddress: string,
  staking?: StakingMetadata,
  cdp?: CDPMetadata,
  pools: PoolMetadata[] = []
): TokenAllowanceRequirement[] {
  const requirement = (tokenAddress: string, spenderAddress: string, amount: string) => ({
    issueId: issue.issueId,
    tokenAddress: strip0x(tokenAddress),
    ownerAddress: strip0x(ownerAddress),
    spenderAddress: strip0x(spenderAddress),
    amount: String(amount),
  });
  const validAmount = (value: string) => /^\d+$/.test(value) && BigInt(value) > 0n;

  if (issue.func === "stake" && staking && eq(issue.target, staking.stakingAddress)) {
    const amount = issue.args[1] ?? "0";
    return validAmount(amount) ? [requirement(staking.stratoTokenAddress, issue.target, amount)] : [];
  }
  if (issue.func === "deposit" && cdp && eq(issue.target, cdp.engineAddress)) {
    const amount = issue.args[1] ?? "0";
    return validAmount(amount) ? [requirement(issue.args[0] ?? "", cdp.vaultAddress, amount)] : [];
  }

  const pool = pools.find((item) => eq(item.address, issue.target));
  if (!pool) return [];
  if (issue.func === "addLiquidity") {
    const tokenBAmount = issue.args[0] ?? "0";
    const tokenAAmount = issue.args[1] ?? "0";
    return [
      ...(validAmount(tokenAAmount) ? [requirement(pool.tokenA.address, issue.target, tokenAAmount)] : []),
      ...(validAmount(tokenBAmount) ? [requirement(pool.tokenB.address, issue.target, tokenBAmount)] : []),
    ];
  }
  if (issue.func === "addLiquiditySingleToken") {
    const amount = issue.args[1] ?? "0";
    const token = String(issue.args[0]).toLowerCase() === "true" ? pool.tokenA : pool.tokenB;
    return validAmount(amount) ? [requirement(token.address, issue.target, amount)] : [];
  }
  if (issue.func === "addLiquidityGeneral" && pool.coins?.length) {
    const parsed = parseArgText(issue.args[0] ?? "[]");
    const amounts = Array.isArray(parsed) ? parsed.map(String) : [];
    return pool.coins.flatMap((coin, index) => {
      const amount = amounts[index] ?? "0";
      return validAmount(amount) ? [requirement(coin.address, issue.target, amount)] : [];
    });
  }
  return [];
}

function IssuesTab({ wallet, fullRoute }: { wallet: UserWallet; fullRoute: UserWallet[] }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { config } = useIsMultisig(wallet.address);
  const { data: signers = [] } = useSigners(wallet.address);
  const { data: issues = [], isLoading, error: issuesError, refetch, isFetching, dataUpdatedAt } = useOpenIssues(wallet.address);
  // Queue countdowns advance with the 3-second issue refresh
  const now = Math.floor(dataUpdatedAt / 1000);
  const { data: thresholds = {} } = useVotingThresholds(wallet.address);
  const tokenMeta = useTokenMeta(wallet.address);
  const stakingMetadata = useStakingMetadata();
  const cdpMetadata = useCDPMetadata();
  const poolMetadata = usePoolMetadata();
  const allowanceRequirements = useMemo(() => issues.flatMap((issue) =>
    issueAllowanceRequirements(
      issue,
      wallet.address,
      stakingMetadata.data,
      cdpMetadata.data,
      poolMetadata.data
    )
  ), [issues, wallet.address, stakingMetadata.data, cdpMetadata.data, poolMetadata.data]);
  const allowanceChecks = useTokenAllowanceRequirements(allowanceRequirements);
  const blockedActionIssues = new Set([
    ...allowanceChecks.filter((check) => !check.ready).map((check) => check.issueId),
    ...issues.filter((issue) =>
      (issue.func === "stake" && !stakingMetadata.data) ||
      (issue.func === "deposit" && !cdpMetadata.data) ||
      (["addLiquidity", "addLiquiditySingleToken", "addLiquidityGeneral"].includes(issue.func) &&
        !poolMetadata.data)
    ).map((issue) => issue.issueId),
  ]);
  const nested = fullRoute.length > 1;
  const routeAddrs = fullRoute.map((w) => w.address);
  const {
    castVote,
    addSigner,
    removeSigner,
    swapSigner,
    setDefaultThreshold,
    dismissIssue,
    withdrawVote,
    executeIssue,
    cancelIssue,
    proposeTransfer,
  } = useMultisigActions({ walletAddress: wallet.address, route: routeAddrs });
  const issueSim = useSimulation();
  const [simFor, setSimFor] = useState<string>("");

  const me = strip0x(userAddress ?? "");
  const iAmSigner = signers.some((s) => eq(s, me));
  const canVote = iAmSigner || nested;
  // The identity whose vote lands on this wallet's issues: you when voting
  // directly, otherwise the last multisig on the route before this wallet.
  const voterAddr = nested ? strip0x(fullRoute[fullRoute.length - 2].address) : me;
  const viaName = nested ? hopName(fullRoute[0]) : "";
  const [busy, setBusy] = useState<string>("");
  const [proposing, setProposing] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-signers", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-config", wallet.address] });
    if (nested)
      queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", fullRoute[0].address] });
  };

  const vote = async (issue: OpenIssue) => {
    if (!canVote) {
      toast.error("Only a signer (or nested member) can vote");
      return;
    }
    if (blockedActionIssues.has(issue.issueId)) {
      toast.error("Complete the linked token approval first");
      return;
    }
    setBusy(issue.issueId);
    try {
      const canonical = await typedIssueArgs(issue.target, issue.func, issue.args);
      if (nested) {
        // A nested vote always goes through castVoteOnIssue with the issue's raw
        // target/func/args, wrapped once per hop; the issueId here still matches
        // votes cast directly (or via the addAdmin-style wrappers).
        await castVote(issue.func, canonical, issue.target || undefined);
      } else {
        // Re-cast through the same call path that created the issue so the issueId
        // (keccak of target/func/args) matches and the vote lands on the same issue.
        switch (issue.func) {
          case "_addAdmin":
            await addSigner(issue.args[0] ?? "");
            break;
          case "_removeAdmin":
            await removeSigner(issue.args[0] ?? "");
            break;
          case "_swapAdmin":
            await swapSigner(issue.args[0] ?? "", issue.args[1] ?? "");
            break;
          case "setDefaultVotingThresholdBps":
            await setDefaultThreshold(Number(issue.args[0] ?? 0));
            break;
          case "transfer":
            await proposeTransfer(issue.target, issue.args[0] ?? "", String(issue.args[1] ?? "0"));
            break;
          default:
            await castVote(issue.func, canonical, issue.target);
        }
      }
      toast.success(
        nested ? `Vote proposed in ${viaName}` : "Vote cast",
        nested
          ? { description: "It lands here once each multisig on the route passes its own vote." }
          : undefined
      );
      invalidate();
    } catch (err: any) {
      toast.error("Vote failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const simulateVote = async (issue: OpenIssue) => {
    const canonical = await typedIssueArgs(issue.target, issue.func, issue.args);
    setSimFor(issue.issueId);
    issueSim.run(
      "FUNCTION",
      buildNestedCastVotePayload(routeAddrs, issue.func, canonical, issue.target || undefined)
    );
  };

  const dismiss = async (issue: OpenIssue) => {
    setBusy(`${issue.issueId}:dismiss`);
    try {
      await dismissIssue(issue.issueId);
      toast.success("Issue dismissed");
      invalidate();
    } catch (err: any) {
      toast.error("Dismiss failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const withdraw = async (issue: OpenIssue) => {
    setBusy(`${issue.issueId}:withdraw`);
    try {
      await withdrawVote({ ...issue, args: await typedIssueArgs(issue.target, issue.func, issue.args) });
      toast.success("Vote withdrawn");
      invalidate();
    } catch (err: any) {
      toast.error("Vote withdrawal failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const execute = async (issue: OpenIssue) => {
    if (blockedActionIssues.has(issue.issueId)) {
      toast.error("Complete the linked token approval first");
      return;
    }
    setBusy(`${issue.issueId}:execute`);
    try {
      await executeIssue({ ...issue, args: await typedIssueArgs(issue.target, issue.func, issue.args) });
      toast.success("Issue executed");
      invalidate();
    } catch (err: any) {
      toast.error("Execute failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const cancel = async (issue: OpenIssue) => {
    setBusy(`${issue.issueId}:cancel`);
    try {
      await cancelIssue(issue.issueId);
      toast.success(nested ? `Cancel proposed in ${viaName}` : "Vote cast to cancel", {
        description: "The cancel runs as soon as enough signers vote for it, without waiting out the timelock.",
      });
      invalidate();
    } catch (err: any) {
      toast.error("Cancel failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Open issues</div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
        <Button
          size="sm"
          variant={proposing ? "secondary" : "outline"}
          onClick={() => setProposing((v) => !v)}
          disabled={!canVote}
        >
          {proposing ? "Close" : "Propose issue"}
        </Button>
      </div>

      {!canVote ? (
        <p className="text-xs text-muted-foreground">
          Only a signer can propose or vote on issues.
        </p>
      ) : nested ? (
        <p className="text-xs text-muted-foreground">
          You vote here through {fullRoute.slice(0, -1).map(hopName).join(" → ")}: each vote
          below creates/joins an issue in {viaName} and lands here once every multisig on the
          route passes its own threshold.
        </p>
      ) : null}

      {proposing ? (
        <ProposeIssueForm
          walletAddress={wallet.address}
          fullRoute={fullRoute}
          onDone={() => {
            invalidate();
            setProposing(false);
          }}
        />
      ) : null}

      {issuesError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load proposals: {issuesError.message}
        </p>
      ) : null}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading issues…</p>
      ) : issues.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {issuesError ? "Use Refresh to try loading the proposals again." :
            "No open issues. Proposals appear here for signers to vote on."}
        </p>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => {
        const label = labelForIssue(issue, tokenMeta, signers.length);
        const count = issue.invalidated ? 0 : issue.voters.length;
        // The Multisig logic has one threshold, except that handing the wallet to a new
        // owner takes every signer
        const bps = (!config.runsMultisigLogic && thresholds[`${issue.target}|${issue.func}`]) ||
          config.defaultThresholdBps || 6000;
        const unanimous = config.runsMultisigLogic && issue.func === "transferOwnership" &&
          eq(issue.target, wallet.address);
        const needed = unanimous ? signers.length : votesNeeded(signers.length, bps);
        const remaining = Math.max(0, needed - count);
        const recordedMyVote = issue.voters.some((v) => eq(v, voterAddr));
        const iVoted = !issue.invalidated && recordedMyVote;
        const pct = needed > 0 ? Math.min(100, (count / needed) * 100) : 0;
        const queued = issue.queued;
        const ready = !!queued && now >= queued.executableAt && now <= queued.expiresAt;
        const waitingForAllowance = blockedActionIssues.has(issue.issueId);
        // Mirrors the contract's dismissIssue gate: a single vote, cast by the caller.
        const canDismiss = issue.voters.length === 1 && eq(issue.voters[0], me);
        const canWithdraw = !nested && recordedMyVote && (queued || !canDismiss);
        return (
          <div key={issue.issueId} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Vote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {shortenHex(issue.issueId, 8, 6)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {queued ? (
                  <>
                    {canWithdraw ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => withdraw(issue)}
                        disabled={busy !== "" || !canSubmit}
                        title="Retract your approval and move the issue below quorum if necessary"
                      >
                        {busy === `${issue.issueId}:withdraw` ? "Withdrawing…" : "Withdraw vote"}
                      </Button>
                    ) : null}
                    {canVote ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => cancel(issue)}
                        disabled={busy !== "" || !canSubmit}
                        title="Proposes cancelling this issue; the cancel runs as soon as it passes"
                        className="text-destructive hover:text-destructive"
                      >
                        {busy === `${issue.issueId}:cancel` ? "Voting…" : nested ? `Cancel via ${viaName}` : "Cancel"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={() => execute(issue)}
                      disabled={busy !== "" || !canSubmit || !ready || waitingForAllowance}
                      title={waitingForAllowance ? "Complete the linked token approval first" :
                        ready ? "Anyone can execute a queued issue once its delay is up" : "Not executable now"}
                    >
                      {busy === `${issue.issueId}:execute` ? "Executing…" : "Execute"}
                    </Button>
                  </>
                ) : null}
                {!queued && issueSim.canSimulate && canVote ? (
                  <SimulateButton
                    onClick={() => simulateVote(issue)}
                    pending={issueSim.pending && simFor === issue.issueId}
                    disabled={busy !== ""}
                    label="Simulate"
                  />
                ) : null}
                {!queued && canDismiss ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dismiss(issue)}
                    disabled={busy !== "" || !canSubmit}
                    title="Withdraw this issue before anyone else votes on it"
                    className="text-destructive hover:text-destructive"
                  >
                    {busy === `${issue.issueId}:dismiss` ? "Dismissing…" : "Dismiss"}
                  </Button>
                ) : null}
                {!queued && canWithdraw ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => withdraw(issue)}
                    disabled={busy !== "" || !canSubmit}
                    title="Retract your approval without affecting other signers' votes"
                  >
                    {busy === `${issue.issueId}:withdraw` ? "Withdrawing…" : "Withdraw vote"}
                  </Button>
                ) : null}
                {!queued ? (
                  <Button
                    size="sm"
                    onClick={() => vote(issue)}
                    disabled={busy !== "" || !canSubmit || !canVote || iVoted || waitingForAllowance}
                    title={
                      waitingForAllowance
                        ? "Complete the linked token approval first"
                        : nested
                        ? `Casts your vote in ${viaName}; it arrives here through the membership chain.`
                        : undefined
                    }
                  >
                    {iVoted ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" /> {nested ? "Chain voted" : "Voted"}
                      </span>
                    ) : busy === issue.issueId ? (
                      "Voting…"
                    ) : nested ? (
                      `Vote via ${viaName}`
                    ) : (
                      "Vote"
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-3">
              <Progress value={pct} className="h-1.5" />
              <div className="mt-1 text-xs text-muted-foreground">
                {count} of {needed} approvals · {needed} of {signers.length} signers required
                {!queued && remaining > 0 ? ` · ${remaining} more approval${remaining === 1 ? "" : "s"} needed` : ""}
                {nested && iVoted ? ` — includes ${hopName(fullRoute[fullRoute.length - 2])}` : ""}
              </div>
              {queued ? (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  {now < queued.executableAt
                    ? `Passed and queued: anyone can execute it in ${formatDuration(queued.executableAt - now)}.`
                    : ready
                      ? `Ready: anyone can execute it for another ${formatDuration(queued.expiresAt - now)}.`
                      : "Expired without being executed: it can only be cancelled now."}
                </p>
              ) : null}
              {issue.indexing ? (
                <p className="mt-1 text-xs text-muted-foreground">Proposal confirmed; syncing the issue list.</p>
              ) : null}
              {waitingForAllowance ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Waiting for the linked token approval to execute and index before more votes can be cast.
                </p>
              ) : null}
              {issue.invalidated ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Invalidated by a signer or threshold change: earlier votes no longer count.
                  Voting starts it again.
                </p>
              ) : null}
            </div>
            {simFor === issue.issueId ? (
              <div className="mt-3">
                <SimulationResultPanel
                  result={issueSim.result}
                  error={issueSim.error}
                  title={nested ? `Your vote tx in ${viaName}` : "Vote tx"}
                  effectTitles={effectChainTitles(fullRoute, issue.func, issue.args)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* Propose a generic issue                                                            */
/* --------------------------------------------------------------------------------- */

/**
 * Propose an arbitrary issue: target contract + function + positional args → the
 * multisig's `castVoteOnIssue`, which executes `target.func(args)` from the wallet
 * once the vote threshold is met. If the target resolves to a known contract, its
 * functions/args are offered from the ABI; otherwise everything can be entered by hand.
 */
function ProposeIssueForm({
  walletAddress,
  fullRoute,
  onDone,
}: {
  walletAddress: string;
  fullRoute: UserWallet[];
  onDone: () => void;
}) {
  const { canSubmit } = useSubmitTransaction();
  const nested = fullRoute.length > 1;
  const routeAddrs = fullRoute.map((w) => w.address);
  const { castVote } = useMultisigActions({ walletAddress, route: routeAddrs });
  // One simulation of the castVoteOnIssue tx; the endpoint automatically nests
  // the proposal's effects — one per vote hop, then the ultimate action.
  const proposalSim = useSimulation();

  const [target, setTarget] = useState("");
  const [showSug, setShowSug] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [selectedFunc, setSelectedFunc] = useState("");
  const [manualFunc, setManualFunc] = useState("");
  const [abiArgs, setAbiArgs] = useState<Record<string, string>>({});
  const [abiArgAddrs, setAbiArgAddrs] = useState<Record<string, string>>({});
  const [manualArgs, setManualArgs] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

  // A stale dry-run is misleading once the proposal inputs change; clear the
  // panel on any edit.
  const proposalSimReset = proposalSim.reset;
  useEffect(() => {
    proposalSimReset();
  }, [proposalSimReset, target, manualMode, selectedFunc, manualFunc, abiArgs, abiArgAddrs, manualArgs]);

  const isAddr = isAddressLike(target);
  const searchQ = isAddr ? strip0x(target) : target.trim().length >= 2 ? target.trim() : "";
  const { data: groups } = useContractGroups(searchQ);

  const resolvedAddress = isAddr ? strip0x(target) : "";
  const resolvedName = useMemo(() => {
    if (!resolvedAddress || !groups) return "";
    const g = groups.find((grp) => grp.addresses.some((a) => strip0x(a) === resolvedAddress));
    return g?.name ?? "";
  }, [groups, resolvedAddress]);

  const { data: info } = useContractInfo(resolvedName || null, resolvedAddress || null);
  const abiFunctions = useMemo(() => {
    const fns = (info?._functions ?? {}) as Record<string, any>;
    return Object.keys(fns)
      .filter((f) => {
        if (!f || f === "constructor") return false;
        const vis = fns[f]?._funcVisibility;
        return !vis || vis === "public" || vis === "external";
      })
      .sort();
  }, [info]);

  const useAbi = !manualMode && abiFunctions.length > 0;
  const abiFuncArgs = useMemo(
    () => (useAbi && selectedFunc && info ? functionArgs(info, selectedFunc) : []),
    [useAbi, selectedFunc, info]
  );
  const func = (useAbi ? selectedFunc : manualFunc).trim();

  const suggestions = useMemo(() => {
    if (isAddr || !groups || searchQ.length < 2) return [];
    const out: { name: string; address: string }[] = [];
    for (const g of groups) for (const a of g.addresses.slice(0, 3)) out.push({ name: g.name, address: a });
    return out.slice(0, 8);
  }, [groups, isAddr, searchQ]);

  const buildArgs = (): unknown[] => {
    if (useAbi && selectedFunc) {
      return abiFuncArgs.map((a) => {
        const raw = abiArgs[a.name] ?? "";
        return typedVariadicArg(a.type, raw, abiArgAddrs[a.name]);
      });
    }
    return manualArgs.map((a) => a.trim()).filter((a) => a.length > 0)
      .map((a) => formatVariadicArg(parseArgText(a)));
  };

  const reset = () => {
    setTarget("");
    setSelectedFunc("");
    setManualFunc("");
    setAbiArgs({});
    setAbiArgAddrs({});
    setManualArgs([""]);
    setManualMode(false);
    proposalSim.reset();
  };

  const submit = async () => {
    if (resolvedAddress.length !== 40) {
      toast.error("Enter a valid contract address");
      return;
    }
    if (!func) {
      toast.error("Enter a function name");
      return;
    }
    setBusy(true);
    try {
      await castVote(func, buildArgs(), resolvedAddress);
      toast.success("Issue proposed", {
        description: nested
          ? `Proposed in ${hopName(fullRoute[0])}; it lands here once each multisig on the route passes its own vote.`
          : "Signers can vote on it below.",
      });
      reset();
      onDone();
    } catch (err: any) {
      toast.error("Proposal failed", { description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (resolvedAddress.length !== 40 || !func) {
      toast.error("Enter a target contract and function first");
      return;
    }
    // Simulate the (possibly route-wrapped) castVoteOnIssue tx; the endpoint
    // nests one effect per vote hop, ending at target.func(args).
    proposalSim.run(
      "FUNCTION",
      buildNestedCastVotePayload(routeAddrs, func, buildArgs(), resolvedAddress)
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      {/* Target contract */}
      <div className="relative space-y-1">
        <Label>Target contract</Label>
        <Input
          placeholder="Contract address or name"
          autoComplete="off"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setShowSug(true);
            setSelectedFunc("");
          }}
          onFocus={() => setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 150)}
          className="font-mono text-xs"
        />
        {showSug && suggestions.length > 0 ? (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((s) => (
              <button
                type="button"
                key={`${s.name}-${s.address}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setTarget(strip0x(s.address));
                  setShowSug(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {shortenHex(s.address)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {resolvedAddress && resolvedName ? (
          <p className="text-xs text-muted-foreground">Resolved contract: {resolvedName}</p>
        ) : null}
      </div>

      {/* Function */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>Function</Label>
          {abiFunctions.length > 0 ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => {
                setManualMode((m) => !m);
                setSelectedFunc("");
              }}
            >
              {manualMode ? "Pick from contract" : "Enter manually"}
            </button>
          ) : null}
        </div>
        {useAbi ? (
          <Select value={selectedFunc} onValueChange={setSelectedFunc}>
            <SelectTrigger>
              <SelectValue placeholder="Select a function" />
            </SelectTrigger>
            <SelectContent>
              {abiFunctions.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            placeholder="functionName"
            value={manualFunc}
            onChange={(e) => setManualFunc(e.target.value)}
            className="font-mono text-xs"
          />
        )}
      </div>

      {/* Arguments */}
      <div className="space-y-1">
        <Label>Arguments</Label>
        {useAbi && selectedFunc ? (
          abiFuncArgs.length === 0 ? (
            <p className="text-xs text-muted-foreground">This function takes no arguments.</p>
          ) : (
            abiFuncArgs.map((a) =>
              isPlainAddressType(a.type) ? (
                <AddressInput
                  key={a.name}
                  value={abiArgs[a.name] ?? ""}
                  resolved={abiArgAddrs[a.name] ?? ""}
                  onChange={(text, addr) => {
                    setAbiArgs((prev) => ({ ...prev, [a.name]: text }));
                    setAbiArgAddrs((prev) => ({ ...prev, [a.name]: addr }));
                  }}
                  placeholder={`${a.name} (${a.type})`}
                  className="font-mono text-xs"
                />
              ) : (
                <Input
                  key={a.name}
                  placeholder={`${a.name} (${a.type})`}
                  value={abiArgs[a.name] ?? ""}
                  onChange={(e) => setAbiArgs((prev) => ({ ...prev, [a.name]: e.target.value }))}
                  className="font-mono text-xs"
                />
              )
            )
          )
        ) : (
          <>
            {manualArgs.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder={`arg ${i + 1}`}
                  value={a}
                  onChange={(e) =>
                    setManualArgs((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                  }
                  className="font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setManualArgs((prev) =>
                      prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i)
                    )
                  }
                  aria-label="Remove argument"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualArgs((prev) => [...prev, ""])}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add argument
            </Button>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Arguments are passed positionally. When the vote passes, the multisig calls the function
        on the target contract.
      </p>

      {/* The panel nests the issue's effect chain (one hop per multisig on the
          route, then the ultimate action), computed by the simulate endpoint. */}
      <SimulationResultPanel
        result={proposalSim.result}
        error={proposalSim.error}
        title={nested ? `Proposal tx in ${hopName(fullRoute[0])}` : "Proposal tx"}
        effectTitles={effectChainTitles(fullRoute, func, buildArgs())}
      />

      <div className="flex gap-2">
        {proposalSim.canSimulate ? (
          <SimulateButton
            onClick={simulate}
            pending={proposalSim.pending}
            disabled={resolvedAddress.length !== 40 || !func}
          />
        ) : null}
        <Button
          onClick={submit}
          disabled={busy || !canSubmit || resolvedAddress.length !== 40 || !func}
          className="flex-1"
        >
          {busy ? "Proposing…" : "Propose issue"}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* History tab                                                                        */
/* --------------------------------------------------------------------------------- */

const PAGE = 10;

function HistoryTab({ wallet }: { wallet: UserWallet }) {
  const [page, setPage] = useState(0);
  const { data: executed = [], isLoading } = useExecutedIssues(wallet.address, PAGE, page * PAGE);
  const tokenMeta = useTokenMeta(wallet.address);
  const { data: signers = [] } = useSigners(wallet.address);

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading history…</p>
      ) : executed.length === 0 && page === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No executed issues yet.</p>
      ) : (
        <div className="space-y-2">
          {executed.map((ex, i) => {
            const label = labelForIssue(ex, tokenMeta, signers.length);
            return (
              <div
                key={`${ex.issueId}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">{label}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {ex.executor ? `by ${shortenHex(ex.executor, 6, 4)}` : ""}
                    {ex.block ? ` · block ${ex.block}` : ""}
                  </div>
                </div>
                <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}

      {page > 0 || executed.length === PAGE ? (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={executed.length < PAGE}
            >
              Next
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* Treasury tab                                                                       */
/* --------------------------------------------------------------------------------- */

function TreasuryTab({ wallet, fullRoute }: { wallet: UserWallet; fullRoute: UserWallet[] }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { data: signers = [] } = useSigners(wallet.address);
  const nested = fullRoute.length > 1;
  const { proposeTransfer } = useMultisigActions({
    walletAddress: wallet.address,
    route: fullRoute.map((w) => w.address),
  });

  const me = strip0x(userAddress ?? "");
  // Nested members propose transfers through their membership chain.
  const canVote = signers.some((s) => eq(s, me)) || nested;

  const { data: myTokens = [] } = useMyTokens(userAddress); // depositor's balances
  const { data: treasury = [] } = useMyTokens(wallet.address); // multisig's balances
  const { data: deployed, isLoading: deployedLoading, isError: deployedError } = useDeployedPositions(wallet.address);
  const hasStaked = isPositiveRaw(deployed?.staking.stakedAmount);
  const hasUnbonding = isPositiveRaw(deployed?.staking.unbondingAmount);
  const hasDeployedPositions = hasStaked || hasUnbonding || !!deployed?.collateral.length;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tokens", userAddress] });
    queryClient.invalidateQueries({ queryKey: ["my-tokens", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
  };

  return (
    <div className="space-y-6">
      {/* Holdings */}
      <div className="space-y-2">
        <Label>Available holdings</Label>
        {treasury.length === 0 ? (
          <p className="text-sm text-muted-foreground">This multisig holds no tokens yet.</p>
        ) : (
          <div className="space-y-1.5">
            {treasury.map((t) => (
              <div
                key={t.address}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{t.symbol}</span>
                <span className="font-mono text-xs">{humanBalance(t)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Deployed positions</Label>
        {deployedLoading ? (
          <p className="text-sm text-muted-foreground">Loading deployed positions…</p>
        ) : deployedError ? (
          <p className="text-sm text-muted-foreground">Deployed positions are temporarily unavailable.</p>
        ) : !hasDeployedPositions ? (
          <p className="text-sm text-muted-foreground">No staked tokens or supplied collateral.</p>
        ) : (
          <div className="space-y-1.5">
            {hasStaked ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">Staked {deployed!.staking.tokenSymbol}</span>
                  <p className="text-xs text-muted-foreground">
                    {deployed!.staking.validatorCount} validator{deployed!.staking.validatorCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="font-mono text-xs">
                  {safeFormatUnits(deployed!.staking.stakedAmount, deployed!.staking.tokenDecimals)}
                </span>
              </div>
            ) : null}
            {hasUnbonding ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">Unbonding {deployed!.staking.tokenSymbol}</span>
                  <p className="text-xs text-muted-foreground">Held by the staking contract</p>
                </div>
                <span className="font-mono text-xs">
                  {safeFormatUnits(deployed!.staking.unbondingAmount, deployed!.staking.tokenDecimals)}
                </span>
              </div>
            ) : null}
            {deployed?.collateral.map((position) => (
              <div
                key={position.asset}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{position.symbol} collateral</span>
                  <p className="text-xs text-muted-foreground">Supplied to CDP</p>
                </div>
                <span className="font-mono text-xs">{safeFormatUnits(position.amount, position.decimals)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Deposit */}
      <DepositForm
        toAddress={wallet.address}
        tokens={myTokens}
        disabled={!canSubmit}
        onDone={refresh}
      />

      <Separator />

      {/* Propose transfer */}
      <ProposeTransferForm
        tokens={treasury}
        iAmSigner={canVote}
        canSubmit={canSubmit}
        onPropose={proposeTransfer}
        onDone={refresh}
      />
    </div>
  );
}

const ACTION_LABELS: Record<ProtocolActionKind, string> = {
  stake: "Stake",
  unstake: "Unstake",
  cdpDeposit: "CDP deposit",
  cdpBorrow: "CDP borrow",
  addLiquidity: "Add dual-token liquidity",
  addLiquiditySingle: "Add single-token liquidity",
  addLiquidityStable: "Add stable multi-token liquidity",
  removeLiquidity: "Remove dual-token liquidity",
  removeLiquidityStable: "Remove stable multi-token liquidity",
  removeLiquidityOneCoin: "Remove stable liquidity as one coin",
};

/** Action label as part of a sentence, while preserving protocol acronyms. */
const proposalActionLabel = (action: ProtocolActionKind): string => {
  const label = ACTION_LABELS[action];
  return label.startsWith("CDP ") ? label : label.charAt(0).toLowerCase() + label.slice(1);
};

const validContractAddress = (value: string) => strip0x(value.trim()).length === 40 && isAddressLike(value.trim());
const positiveInteger = (value: string) => /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
const nonNegativeInteger = (value: string) => /^\d+$/.test(value.trim());
const textArray = (value: string): string[] => {
  const parsed = parseArgText(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
};

/**
 * Protocol calls made from a self-owned wallet must originate in the wallet, so SMD
 * creates typed multisig issues instead of sending the protocol transaction directly.
 * Approval-dependent workflows create approval issues first and the action issue second.
 * The Issues tab prevents later action votes until Cirrus confirms every allowance.
 */
function ProtocolActionsTab({ wallet, fullRoute }: { wallet: UserWallet; fullRoute: UserWallet[] }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { data: signers = [] } = useSigners(wallet.address);
  const { castVote } = useMultisigActions({
    walletAddress: wallet.address,
    route: fullRoute.map((w) => w.address),
  });
  const nested = fullRoute.length > 1;
  const canVote = nested || signers.some((s) => eq(s, userAddress ?? ""));
  const stakingMetadata = useStakingMetadata();
  const cdpMetadata = useCDPMetadata();
  const poolMetadata = usePoolMetadata();

  // Require an explicit operation choice. Defaulting to Stake is unsafe because a
  // remount could silently replace a user's previous liquidity/CDP selection.
  const [action, setAction] = useState<ProtocolActionKind | null>(null);
  const [manualAddresses, setManualAddresses] = useState(false);
  const [target, setTarget] = useState("");
  const [validator, setValidator] = useState("");
  const [asset, setAsset] = useState("");
  const [spender, setSpender] = useState("");
  const [tokenA, setTokenA] = useState("");
  const [tokenB, setTokenB] = useState("");
  const [amount, setAmount] = useState("");
  const [amount2, setAmount2] = useState("");
  const [amount3, setAmount3] = useState("");
  const [tokensText, setTokensText] = useState("");
  const [amountsText, setAmountsText] = useState("");
  const [coinIndex, setCoinIndex] = useState("");
  const [isAToB, setIsAToB] = useState(true);
  const [busy, setBusy] = useState<"action" | "">("");

  const isStakingAction = action === "stake" || action === "unstake";
  const isCDPAction = action === "cdpDeposit" || action === "cdpBorrow";
  const isStablePoolAction = action === "addLiquidityStable" ||
    action === "removeLiquidityStable" || action === "removeLiquidityOneCoin";
  const isPoolAction = !!action && !isStakingAction && !isCDPAction;
  const availablePools = useMemo(() => (poolMetadata.data ?? []).filter((pool) =>
    !pool.isPaused && !pool.isDisabled &&
    (isStablePoolAction ? !!pool.coins?.length : !pool.coins?.length)
  ), [poolMetadata.data, isStablePoolAction]);
  const selectedPool = availablePools.find((pool) => eq(pool.address, target));

  const applyPool = (pool: PoolMetadata) => {
    setTarget(pool.address);
    setTokenA(pool.tokenA.address);
    setTokenB(pool.tokenB.address);
    if (pool.coins?.length) setTokensText(JSON.stringify(pool.coins.map((coin) => coin.address)));
    if (action === "addLiquiditySingle") setAsset(isAToB ? pool.tokenA.address : pool.tokenB.address);
  };

  useEffect(() => {
    if (manualAddresses || !isStakingAction || !stakingMetadata.data) return;
    setTarget(stakingMetadata.data.stakingAddress);
    setAsset(stakingMetadata.data.stratoTokenAddress);
    setValidator(stakingMetadata.data.validators.find((item) => item.active)?.address || "");
  }, [manualAddresses, action, isStakingAction, stakingMetadata.data]);

  useEffect(() => {
    if (manualAddresses || !isCDPAction || !cdpMetadata.data) return;
    setTarget(cdpMetadata.data.engineAddress);
    setSpender(cdpMetadata.data.vaultAddress);
    setAsset(cdpMetadata.data.assets.find((item) => item.isSupported && !item.isPaused)?.asset || "");
  }, [manualAddresses, action, isCDPAction, cdpMetadata.data]);

  useEffect(() => {
    if (manualAddresses || !isPoolAction || !availablePools.length) return;
    const pool = availablePools.find((item) => eq(item.address, target)) ?? availablePools[0];
    applyPool(pool);
    // Action changes intentionally reset the target, so the first compatible pool is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualAddresses, action, poolMetadata.data]);

  const changeAction = (value: ProtocolActionKind) => {
    setAction(value);
    // Contract addresses and amounts are operation-specific. Clearing them avoids
    // accidentally proposing a new operation against the previous operation's target.
    setTarget("");
    setValidator("");
    setAsset("");
    setSpender("");
    setTokenA("");
    setTokenB("");
    setAmount("");
    setAmount2("");
    setAmount3("");
    setTokensText("");
    setAmountsText("");
    setCoinIndex("");
    setIsAToB(true);
  };

  const stableTokens = textArray(tokensText);
  const stableAmounts = textArray(amountsText);
  const approvalSpender = action === "stake" || action === "addLiquidity" ||
      action === "addLiquiditySingle" || action === "addLiquidityStable"
    ? target
    : action === "cdpDeposit"
      ? spender
      : "";
  const approvalRequired = action === "stake" || action === "cdpDeposit" ||
    action === "addLiquidity" || action === "addLiquiditySingle" || action === "addLiquidityStable";
  const approvalSpecs = action === "addLiquidity"
    ? [{ token: tokenA, value: amount2 }, { token: tokenB, value: amount }]
    : action === "addLiquidityStable"
      ? stableTokens.map((token, index) => ({ token, value: stableAmounts[index] ?? "0" }))
          .filter(({ value }) => positiveInteger(value))
      : approvalRequired
        ? [{ token: asset, value: amount }]
        : [];
  const approvalInputsComplete = approvalRequired && validContractAddress(approvalSpender) &&
    approvalSpecs.length > 0 && approvalSpecs.every(({ token, value }) =>
      validContractAddress(token) && positiveInteger(value)) &&
    (action !== "addLiquidityStable" || (stableTokens.length === stableAmounts.length &&
      stableTokens.length > 0 && stableTokens.every(validContractAddress) &&
      stableAmounts.every(nonNegativeInteger)));
  const allowances = useTokenAllowances(
    approvalSpecs.map(({ token }) => token),
    wallet.address,
    validContractAddress(approvalSpender) ? approvalSpender : null
  );

  const allowanceEnough = (allowance: string | undefined, required: string) => {
    try {
      return positiveInteger(required) && BigInt(allowance || "0") >= BigInt(required);
    } catch {
      return false;
    }
  };
  const missingApprovals = approvalSpecs.filter(({ value }, index) =>
    !allowanceEnough(allowances.data?.[index], value));
  const approvalReady = !approvalRequired || (approvalInputsComplete && missingApprovals.length === 0);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
    allowances.refetch();
  };

  const proposeWorkflow = async () => {
    if (!canVote) return toast.error("Only a signer can propose this action");
    if (!action) return toast.error("Select a protocol operation");
    const selectedAction = action;
    if (!validContractAddress(target)) return toast.error("Enter a valid protocol contract address");
    if (!manualAddresses && isPoolAction && !selectedPool) {
      return toast.error("Select a valid pool for this liquidity action");
    }
    if (approvalRequired && !approvalInputsComplete) {
      return toast.error("Enter valid token addresses and approval amounts");
    }
    if (approvalRequired && !allowances.isSuccess) {
      return toast.info("Checking existing token allowances");
    }

    try {
      switch (selectedAction) {
        case "stake":
        case "unstake":
          if (!validContractAddress(validator)) throw new Error("Enter a valid validator address");
          if (selectedAction === "stake" && !validContractAddress(asset)) throw new Error("Enter a valid STRATO token address");
          if (!positiveInteger(amount)) throw new Error("Enter a positive amount in raw units");
          break;
        case "cdpDeposit":
          if (!validContractAddress(asset)) throw new Error("Enter a valid collateral token address");
          if (!validContractAddress(spender)) throw new Error("Enter a valid CDP vault address");
          if (!positiveInteger(amount)) throw new Error("Enter a positive amount in raw units");
          break;
        case "cdpBorrow":
          if (!validContractAddress(asset)) throw new Error("Enter a valid collateral token address");
          if (!positiveInteger(amount)) throw new Error("Enter a positive USDST amount in raw units");
          break;
        case "addLiquidity":
          if (!validContractAddress(tokenA) || !validContractAddress(tokenB)) throw new Error("Enter both pool token addresses");
          if (!positiveInteger(amount) || !positiveInteger(amount2)) throw new Error("Enter positive token amounts in raw units");
          break;
        case "addLiquiditySingle":
          if (!validContractAddress(asset)) throw new Error("Enter the deposited token address");
          if (!positiveInteger(amount)) throw new Error("Enter a positive token amount in raw units");
          break;
        case "addLiquidityStable":
          if (!approvalInputsComplete) throw new Error("Enter matching token and amount arrays");
          if (!positiveInteger(amount2)) throw new Error("Enter a positive minimum LP mint amount");
          break;
        case "removeLiquidity":
          if (![amount, amount2, amount3].every(positiveInteger)) throw new Error("Enter positive LP and minimum token amounts");
          break;
        case "removeLiquidityStable":
          if (!positiveInteger(amount) || stableAmounts.length === 0 || !stableAmounts.every(nonNegativeInteger)) {
            throw new Error("Enter a positive LP amount and a valid minimum-amount array");
          }
          break;
        case "removeLiquidityOneCoin":
          if (!positiveInteger(amount) || !nonNegativeInteger(coinIndex) || !positiveInteger(amount2)) {
            throw new Error("Enter a positive LP amount, coin index, and minimum received amount");
          }
          break;
      }
      const workflow = buildProtocolWorkflowCalls(selectedAction, {
        target, validator, asset, amount, amount2, amount3,
        amounts: stableAmounts,
        receiver: wallet.address,
        coinIndex,
        isAToB,
      }, missingApprovals.map((approval) => ({
        token: approval.token,
        spender: approvalSpender,
        amount: approval.value,
      })));
      setBusy("action");
      for (const call of workflow) {
        await castVote(call.func, call.args, call.target);
      }
      toast.success(`${ACTION_LABELS[selectedAction]} workflow proposed`, {
        description: missingApprovals.length
          ? "Approval issues were created first. The action unlocks for more votes after they execute."
          : "Signers can review and vote on it in the Issues tab.",
      });
      refresh();
    } catch (err: any) {
      toast.error("Workflow proposal failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  const addressInput = (label: string, value: string, setValue: (value: string) => void, placeholder: string) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="font-mono text-xs" />
    </div>
  );
  const amountInput = (label: string, value: string, setValue: (value: string) => void) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Raw integer amount" inputMode="numeric" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Protocol operation</Label>
        <Select value={action ?? undefined} onValueChange={(value) => changeAction(value as ProtocolActionKind)}>
          <SelectTrigger><SelectValue placeholder="Select an operation" /></SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTION_LABELS) as ProtocolActionKind[]).map((value) => (
              <SelectItem key={value} value={value}>{ACTION_LABELS[value]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-sm font-medium">{manualAddresses ? "Manual contract addresses" : "App protocol configuration"}</p>
          <p className="text-xs text-muted-foreground">
            {manualAddresses ? "Advanced mode bypasses metadata prefills." : "Contracts, assets, validators, and pool coin order come from the app backend."}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setManualAddresses((value) => !value)}>
          {manualAddresses ? "Use app defaults" : "Enter manually"}
        </Button>
      </div>

      {!canVote ? (
        <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Only a signer can propose protocol actions.</AlertDescription></Alert>
      ) : null}

      {manualAddresses && action ? addressInput(
        isStakingAction ? "Staking contract" : isCDPAction ? "CDP engine" : "Pool contract",
        target, setTarget, "40-character contract address"
      ) : null}

      {!manualAddresses && isPoolAction ? (
        <div className="space-y-1">
          <Label>Pool</Label>
          <Select value={target} onValueChange={(value) => {
            const pool = availablePools.find((item) => item.address === value);
            if (pool) applyPool(pool);
          }}>
            <SelectTrigger><SelectValue placeholder={poolMetadata.isLoading ? "Loading pools…" : "Select a pool"} /></SelectTrigger>
            <SelectContent>
              {availablePools.map((pool) => (
                <SelectItem key={pool.address} value={pool.address}>
                  {pool.poolName} ({shortenHex(pool.address, 6, 4)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!manualAddresses && validContractAddress(target) ? (
        <p className="break-all font-mono text-xs text-muted-foreground">Contract: {target}</p>
      ) : null}

      {!manualAddresses && ((isStakingAction && stakingMetadata.isError) ||
        (isCDPAction && cdpMetadata.isError) || (isPoolAction && poolMetadata.isError)) ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Protocol metadata could not be loaded. Use manual address entry to continue.</AlertDescription>
        </Alert>
      ) : null}

      {isStakingAction && <>
        {manualAddresses && action === "stake" ? addressInput("STRATO token", asset, setAsset, "Token contract used for approval") : null}
        {manualAddresses ? addressInput("Validator", validator, setValidator, "Validator address") : (
          <div className="space-y-1">
            <Label>Validator</Label>
            <Select value={validator} onValueChange={setValidator}>
              <SelectTrigger><SelectValue placeholder={stakingMetadata.isLoading ? "Loading validators…" : "Select a validator"} /></SelectTrigger>
              <SelectContent>
                {(stakingMetadata.data?.validators ?? []).filter((item) => item.active && validContractAddress(item.address)).map((item) => (
                  <SelectItem key={item.address} value={item.address}>
                    {item.name || shortenHex(item.address, 6, 4)}{item.estimatedApy ? ` · ${item.estimatedApy}% APY` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {amountInput("Amount (raw units)", amount, setAmount)}
      </>}

      {isCDPAction && <>
        {manualAddresses ? addressInput("Collateral token", asset, setAsset, "Collateral asset address") : (
          <div className="space-y-1">
            <Label>Collateral asset</Label>
            <Select value={asset} onValueChange={setAsset}>
              <SelectTrigger><SelectValue placeholder={cdpMetadata.isLoading ? "Loading collateral…" : "Select collateral"} /></SelectTrigger>
              <SelectContent>
                {(cdpMetadata.data?.assets ?? []).filter((item) => item.isSupported && !item.isPaused && validContractAddress(item.asset)).map((item) => (
                  <SelectItem key={item.asset} value={item.asset}>{item.symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {manualAddresses && action === "cdpDeposit" ? addressInput("CDP vault / approval spender", spender, setSpender, "Vault contract address") : null}
        {amountInput(action === "cdpBorrow" ? "USDST to borrow (raw units)" : "Collateral amount (raw units)", amount, setAmount)}
      </>}

      {action === "addLiquidity" && <>
        {manualAddresses ? addressInput("Token A", tokenA, setTokenA, "Token A contract address") :
          <p className="text-xs text-muted-foreground">Token A: {selectedPool?.tokenA._symbol || "—"}</p>}
        {amountInput("Maximum token A amount (raw units)", amount2, setAmount2)}
        {manualAddresses ? addressInput("Token B", tokenB, setTokenB, "Token B contract address") :
          <p className="text-xs text-muted-foreground">Token B: {selectedPool?.tokenB._symbol || "—"}</p>}
        {amountInput("Token B amount (raw units)", amount, setAmount)}
      </>}

      {action === "addLiquiditySingle" && <>
        {manualAddresses ? addressInput("Deposited token", asset, setAsset, "Token contract address") : null}
        <div className="space-y-1">
          <Label>Deposited side</Label>
          <Select value={isAToB ? "a" : "b"} onValueChange={(value) => {
            const nextIsAToB = value === "a";
            setIsAToB(nextIsAToB);
            if (!manualAddresses && selectedPool) {
              setAsset(nextIsAToB ? selectedPool.tokenA.address : selectedPool.tokenB.address);
            }
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Token A{selectedPool ? ` · ${selectedPool.tokenA._symbol}` : ""}</SelectItem>
              <SelectItem value="b">Token B{selectedPool ? ` · ${selectedPool.tokenB._symbol}` : ""}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {amountInput("Token amount (raw units)", amount, setAmount)}
      </>}

      {action === "addLiquidityStable" && <>
        {manualAddresses ? <div className="space-y-1">
          <Label>Coin contract addresses</Label>
          <Input value={tokensText} onChange={(e) => setTokensText(e.target.value)} placeholder='["address0","address1",…]' className="font-mono text-xs" />
        </div> : <p className="text-xs text-muted-foreground">
          Pool coin order: {selectedPool?.coins?.map((coin) => coin._symbol).join(", ") || "—"}
        </p>}
        <div className="space-y-1">
          <Label>Coin amounts (raw units, same order)</Label>
          <Input value={amountsText} onChange={(e) => setAmountsText(e.target.value)} placeholder='["1000","0",…]' className="font-mono text-xs" />
        </div>
        {amountInput("Minimum LP tokens minted (raw units)", amount2, setAmount2)}
      </>}

      {action === "removeLiquidity" && <>
        {amountInput("LP token amount (raw units)", amount, setAmount)}
        {amountInput("Minimum token B amount (raw units)", amount2, setAmount2)}
        {amountInput("Minimum token A amount (raw units)", amount3, setAmount3)}
      </>}

      {action === "removeLiquidityStable" && <>
        {amountInput("LP token amount (raw units)", amount, setAmount)}
        <div className="space-y-1">
          <Label>Minimum coin amounts (raw units, pool order)</Label>
          <Input value={amountsText} onChange={(e) => setAmountsText(e.target.value)} placeholder='["100","200",…]' className="font-mono text-xs" />
        </div>
      </>}

      {action === "removeLiquidityOneCoin" && <>
        {amountInput("LP token amount (raw units)", amount, setAmount)}
        <div className="space-y-1">
          <Label>Coin index</Label>
          {!manualAddresses && selectedPool?.coins?.length ? (
            <Select value={coinIndex} onValueChange={setCoinIndex}>
              <SelectTrigger><SelectValue placeholder="Select coin" /></SelectTrigger>
              <SelectContent>
                {selectedPool.coins.map((coin, index) => (
                  <SelectItem key={coin.address} value={String(index)}>{index} · {coin._symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : <Input value={coinIndex} onChange={(e) => setCoinIndex(e.target.value)} placeholder="0" inputMode="numeric" />}
        </div>
        {amountInput("Minimum coin amount received (raw units)", amount2, setAmount2)}
      </>}

      {approvalRequired ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Prerequisite allowance{approvalSpecs.length > 1 ? "s" : ""}</span>
            <Badge variant={approvalReady ? "secondary" : "outline"}>
              {allowances.isError ? "Unavailable" : !allowances.isSuccess ? "Checking…" :
                approvalReady ? "Already approved" : `${missingApprovals.length} required`}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {allowances.isError
              ? "Allowances could not be verified. Retry after the indexer is available."
              : approvalReady
              ? "The existing allowance is sufficient, so only the action issue will be created."
              : "Submitting creates the exact approval issue(s) first and the action issue second. Signers complete approvals before voting on the action."}
          </p>
        </div>
      ) : null}

      {(action === "addLiquidity" || action === "addLiquiditySingle" || action === "removeLiquidity") ? (
        <p className="text-xs text-muted-foreground">The proposal uses a deadline 60 days from submission; minimum amounts still enforce slippage protection.</p>
      ) : null}

      <Button
        onClick={proposeWorkflow}
        disabled={!action || busy !== "" || !canSubmit || !canVote ||
          (approvalRequired && (!approvalInputsComplete || !allowances.isSuccess))}
        className="w-full"
      >
        {busy === "action" ? "Proposing workflow…" : action
          ? `Propose ${missingApprovals.length
            ? `${missingApprovals.length === 1 ? "approval" : "approvals"} + `
            : ""}${proposalActionLabel(action)}`
          : "Select an operation"}
      </Button>
    </div>
  );
}

/** Token select + amount input + percentage buttons. */
function TokenAmount({
  tokens,
  symbol,
  setSymbol,
  amount,
  setAmount,
  placeholder,
}: {
  tokens: TokenBalance[];
  symbol: string;
  setSymbol: (s: string) => void;
  amount: string;
  setAmount: (s: string) => void;
  placeholder: string;
}) {
  const token = tokens.find((t) => t.symbol === symbol);

  useEffect(() => {
    if (tokens.length && !tokens.some((t) => t.symbol === symbol)) setSymbol(tokens[0].symbol);
  }, [tokens, symbol, setSymbol]);

  const setPct = (p: number) => {
    if (!token) return;
    setAmount(formatUnits((BigInt(token.balance) * BigInt(p)) / 100n, token.decimals));
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={tokens.length ? "Token" : "No tokens"} />
          </SelectTrigger>
          <SelectContent>
            {tokens.map((t) => (
              <SelectItem key={t.address} value={t.symbol}>
                {t.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder={placeholder}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {token ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Balance: {humanBalance(token)} {token.symbol}
          </span>
          <div className="flex gap-1">
            {PERCENTS.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setPct(p)}
              >
                {p === 100 ? "Max" : `${p}%`}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function DepositForm({
  toAddress,
  tokens,
  disabled,
  onDone,
}: {
  toAddress: string;
  tokens: TokenBalance[];
  disabled: boolean;
  onDone: () => void;
}) {
  const { submit } = useSubmitTransaction();
  const [symbol, setSymbol] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const token = tokens.find((t) => t.symbol === symbol);

  const deposit = async () => {
    if (!token) {
      toast.error("Select a token to deposit");
      return;
    }
    let raw = 0n;
    try {
      raw = parseUnits(amount, token.decimals);
      if (raw <= 0n) throw new Error();
    } catch {
      toast.error("Enter a positive amount");
      return;
    }
    if (raw > BigInt(token.balance)) {
      toast.error("Amount exceeds your balance");
      return;
    }
    setBusy(true);
    try {
      // A plain ERC-20 transfer from your account into the multisig — no vote needed.
      await submit("FUNCTION", {
        contractName: token.symbol,
        contractAddress: token.address,
        value: 0,
        method: "transfer",
        args: { to: strip0x(toAddress), value: raw.toString() },
        metadata: {},
      });
      toast.success(`Deposited ${amount} ${token.symbol}`);
      setAmount("");
      onDone();
    } catch (err: any) {
      toast.error("Deposit failed", { description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
        Deposit tokens
      </div>
      <p className="text-xs text-muted-foreground">
        Move tokens from your connected account into this multisig's treasury.
      </p>
      <TokenAmount
        tokens={tokens}
        symbol={symbol}
        setSymbol={setSymbol}
        amount={amount}
        setAmount={setAmount}
        placeholder="Amount to deposit"
      />
      <Button
        onClick={deposit}
        disabled={busy || disabled || !token || !amount.trim()}
        className="w-full"
      >
        {busy ? "Depositing…" : "Deposit"}
      </Button>
    </div>
  );
}

function ProposeTransferForm({
  tokens,
  iAmSigner,
  canSubmit,
  onPropose,
  onDone,
}: {
  tokens: TokenBalance[];
  iAmSigner: boolean;
  canSubmit: boolean;
  onPropose: (tokenAddress: string, to: string, amountRaw: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const token = tokens.find((t) => t.symbol === symbol);

  const resolvedTo = recipientAddress;

  const propose = async () => {
    if (!iAmSigner) {
      toast.error("Only a signer can propose a transfer");
      return;
    }
    if (!token) {
      toast.error("Select a token");
      return;
    }
    if (strip0x(resolvedTo).length !== 40) {
      toast.error("Enter a valid recipient address or pick a user");
      return;
    }
    let raw = 0n;
    try {
      raw = parseUnits(amount, token.decimals);
      if (raw <= 0n) throw new Error();
    } catch {
      toast.error("Enter a positive amount");
      return;
    }
    if (raw > BigInt(token.balance)) {
      toast.error("Amount exceeds the treasury balance");
      return;
    }
    setBusy(true);
    try {
      await onPropose(token.address, resolvedTo, raw.toString());
      toast.success("Transfer proposed", {
        description: "Signers can vote on it in the Issues tab (executes at threshold).",
      });
      setAmount("");
      setRecipient("");
      setRecipientAddress("");
      onDone();
    } catch (err: any) {
      toast.error("Proposal failed", { description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ArrowUpFromLine className="h-4 w-4 text-muted-foreground" />
        Propose a transfer
      </div>
      <p className="text-xs text-muted-foreground">
        Create a proposal to send tokens from the treasury to another address. It executes
        once enough signers vote.
      </p>

      {!iAmSigner ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Only a signer can propose a transfer.</AlertDescription>
        </Alert>
      ) : null}

      {/* Recipient */}
      <AddressInput
        value={recipient}
        resolved={recipientAddress}
        onChange={(text, addr) => {
          setRecipient(text);
          setRecipientAddress(addr);
        }}
        placeholder="Recipient address or username"
        className="font-mono text-xs"
      />

      <TokenAmount
        tokens={tokens}
        symbol={symbol}
        setSymbol={setSymbol}
        amount={amount}
        setAmount={setAmount}
        placeholder="Amount to send"
      />
      <Button
        onClick={propose}
        disabled={busy || !canSubmit || !iAmSigner || !token || !amount.trim()}
        className="w-full"
      >
        {busy ? "Proposing…" : "Propose transfer"}
      </Button>
    </div>
  );
}
