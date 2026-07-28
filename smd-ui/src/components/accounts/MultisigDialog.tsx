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
import { useMyTokens, type TokenBalance } from "@/services/tokens";
import { useContractGroups, useContractInfo, functionArgs } from "@/services/contracts";
import { useSimulation } from "@/components/simulation/useSimulation";
import { SimulateButton } from "@/components/simulation/SimulateButton";
import { SimulationResultPanel } from "@/components/simulation/SimulationResultPanel";
import type { UserWallet } from "@/services/userWallets";
import {
  useAdminRegistryLogic,
  useIsMultisig,
  useSigners,
  useOpenIssues,
  useExecutedIssues,
  useMultisigActions,
  buildCastVotePayload,
  votesNeeded,
  strip0x,
  isZeroAddr,
  type OpenIssue,
} from "@/services/multisig";

/* --------------------------------------------------------------------------------- */
/* Helpers                                                                            */
/* --------------------------------------------------------------------------------- */

const eq = (a?: string, b?: string) => !!a && !!b && strip0x(a) === strip0x(b);

const isAddressLike = (s: string) => /^(0x)?[0-9a-fA-F]{40}$/.test(s.trim());

/** A bare address/account parameter (not an array of them). */
const isPlainAddressType = (t: string) => /^(address|account)$/i.test(t.trim());

const PERCENTS = [25, 50, 75, 100] as const;

/** Balance of a token as a human-readable decimal string. */
function humanBalance(t: TokenBalance): string {
  return safeFormatUnits(t.balance, t.decimals);
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
    case "setDefaultVotingThresholdBps":
      // Label is rendered as "M of N" by labelForIssue (needs the signer count).
      return { label: "Set approval threshold", canonical: [String(Number(a0) || 0)] };
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
    default:
      return { label: func || "(unknown)", canonical: args };
  }
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

export function MultisigDialog({ wallet }: { wallet: UserWallet }) {
  const [open, setOpen] = useState(false);
  const { isMultisig, fullyEnabled, isLoading } = useIsMultisig(open ? wallet.address : null);

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
            Multisig — {wallet.username || "User"}
            {fullyEnabled ? (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" /> Enabled
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Turn this User wallet into a Safe-style multisig governed by signer votes.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading wallet state…</p>
        ) : fullyEnabled ? (
          <EnabledView wallet={wallet} />
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
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { logic: adminLogic, isLoading: logicLoading } = useAdminRegistryLogic();
  const { config, selfOwned, initialized } = useIsMultisig(wallet.address);
  const { enableMultisig } = useMultisigActions({ walletAddress: wallet.address });

  const me = strip0x(userAddress ?? "");
  const [extra, setExtra] = useState<{ text: string; addr: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const logicSet = !isZeroAddr(config.logicContract) && eq(config.logicContract, adminLogic);

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
    const signers = [me, ...extra.map((e) => e.addr).filter(Boolean)];
    setBusy(true);
    try {
      await enableMultisig(adminLogic, signers, { logicSet, initialized, selfOwned });
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
            This wallet already delegates to the AdminRegistry logic but isn't fully locked
            yet. Running the remaining steps below will complete setup.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Enabling multisig runs up to three transactions on this wallet:</p>
        <ol className="ml-4 list-decimal space-y-1">
          <li className={logicSet ? "line-through" : ""}>
            Point the wallet's logic contract at the AdminRegistry governance logic.
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
            By default ~60% of signers must approve each action (e.g. 2 of 2, 2 of 3). You can
            change this once enabled.
          </p>
        </div>
      ) : null}

      <Button
        onClick={run}
        disabled={busy || logicLoading || !canSubmit || !me}
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

function EnabledView({ wallet }: { wallet: UserWallet }) {
  return (
    <Tabs defaultValue="treasury" className="mt-1">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="treasury">Treasury</TabsTrigger>
        <TabsTrigger value="signers">Signers</TabsTrigger>
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="treasury" className="mt-4">
        <TreasuryTab wallet={wallet} />
      </TabsContent>
      <TabsContent value="signers" className="mt-4">
        <SignersTab wallet={wallet} />
      </TabsContent>
      <TabsContent value="issues" className="mt-4">
        <IssuesTab wallet={wallet} />
      </TabsContent>
      <TabsContent value="history" className="mt-4">
        <HistoryTab wallet={wallet} />
      </TabsContent>
    </Tabs>
  );
}

/* --------------------------------------------------------------------------------- */
/* Signers tab                                                                        */
/* --------------------------------------------------------------------------------- */

function SignersTab({ wallet }: { wallet: UserWallet }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { config } = useIsMultisig(wallet.address);
  const { data: signers = [] } = useSigners(wallet.address);
  const { addSigner, removeSigner, setDefaultThreshold } = useMultisigActions({
    walletAddress: wallet.address,
  });

  const me = strip0x(userAddress ?? "");
  const iAmSigner = signers.some((s) => eq(s, me));
  const signerCount = signers.length;
  const needed = votesNeeded(signerCount, config.defaultThresholdBps || 6000);

  const [newSigner, setNewSigner] = useState("");
  const [newSignerAddr, setNewSignerAddr] = useState("");
  const [targetM, setTargetM] = useState<number | null>(null);
  const [busy, setBusy] = useState<string>("");

  const selectedM = Math.min(Math.max(targetM ?? needed, 1), Math.max(1, signerCount));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["multisig-signers", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-config", wallet.address] });
  };

  const guard = () => {
    if (!iAmSigner) {
      toast.error("Only a signer can propose changes");
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
      toast.success("Vote cast to add signer", { description: "Executes once the threshold is met." });
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
    if (signers.length <= 1) {
      toast.error("Cannot remove the last signer");
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

  return (
    <div className="space-y-5">
      {!iAmSigner ? (
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
              {Array.from({ length: Math.max(1, signerCount) }, (_, i) => i + 1).map((m) => (
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
            disabled={busy !== "" || !canSubmit || !iAmSigner || selectedM === needed}
            className="ml-auto"
          >
            {busy === "threshold" ? "Voting…" : "Propose change"}
          </Button>
        </div>
      </div>

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
                onClick={() => doRemove(s)}
                disabled={busy !== "" || !canSubmit || !iAmSigner || signers.length <= 1}
                className="ml-auto text-destructive hover:text-destructive"
              >
                {busy === s ? "Voting…" : "Remove"}
              </Button>
            </div>
          ))}
          {signers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No signers found.</p>
          ) : null}
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
          <Button onClick={doAdd} disabled={busy !== "" || !canSubmit || !iAmSigner || !newSigner.trim()}>
            {busy === "add" ? "Voting…" : "Propose"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Adding, removing, and threshold changes are proposed as issues and take effect once
          enough signers vote.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------- */
/* Issues tab                                                                         */
/* --------------------------------------------------------------------------------- */

function IssuesTab({ wallet }: { wallet: UserWallet }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { config } = useIsMultisig(wallet.address);
  const { data: signers = [] } = useSigners(wallet.address);
  const { data: issues = [], isLoading } = useOpenIssues(wallet.address);
  const tokenMeta = useTokenMeta(wallet.address);
  const {
    castVote,
    addSigner,
    removeSigner,
    swapSigner,
    setDefaultThreshold,
    dismissIssue,
    proposeTransfer,
  } = useMultisigActions({ walletAddress: wallet.address });

  const me = strip0x(userAddress ?? "");
  const iAmSigner = signers.some((s) => eq(s, me));
  const needed = votesNeeded(signers.length, config.defaultThresholdBps || 6000);
  const [busy, setBusy] = useState<string>("");
  const [proposing, setProposing] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-signers", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-config", wallet.address] });
  };

  const vote = async (issue: OpenIssue) => {
    if (!iAmSigner) {
      toast.error("Only a signer can vote");
      return;
    }
    const { canonical } = describeIssue(issue.func, issue.args);
    setBusy(issue.issueId);
    try {
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
      toast.success("Vote cast");
      invalidate();
    } catch (err: any) {
      toast.error("Vote failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Open issues</div>
        <Button
          size="sm"
          variant={proposing ? "secondary" : "outline"}
          onClick={() => setProposing((v) => !v)}
          disabled={!iAmSigner}
        >
          {proposing ? "Close" : "Propose issue"}
        </Button>
      </div>

      {!iAmSigner ? (
        <p className="text-xs text-muted-foreground">
          Only a signer can propose or vote on issues.
        </p>
      ) : null}

      {proposing ? (
        <ProposeIssueForm
          walletAddress={wallet.address}
          onDone={() => {
            invalidate();
            setProposing(false);
          }}
        />
      ) : null}

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading issues…</p>
      ) : issues.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No open issues. Proposals appear here for signers to vote on.
        </p>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => {
        const label = labelForIssue(issue, tokenMeta, signers.length);
        const count = issue.voters.length;
        const iVoted = issue.voters.some((v) => eq(v, me));
        const pct = needed > 0 ? Math.min(100, (count / needed) * 100) : 0;
        // Mirrors the contract's dismissIssue gate: a single vote, cast by the caller.
        const canDismiss = count === 1 && eq(issue.voters[0], me);
        const dismissHint =
          count !== 1
            ? "Only issues with a single vote can be dismissed"
            : !canDismiss
              ? "Only the proposer can dismiss this issue"
              : "Withdraw this issue before anyone else votes on it";
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
                {iAmSigner ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => dismiss(issue)}
                    disabled={busy !== "" || !canSubmit || !canDismiss}
                    title={dismissHint}
                    className="text-destructive hover:text-destructive"
                  >
                    {busy === `${issue.issueId}:dismiss` ? "Dismissing…" : "Dismiss"}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => vote(issue)}
                  disabled={busy !== "" || !canSubmit || !iAmSigner || iVoted}
                >
                  {iVoted ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Voted
                    </span>
                  ) : busy === issue.issueId ? (
                    "Voting…"
                  ) : (
                    "Vote"
                  )}
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <Progress value={pct} className="h-1.5" />
              <div className="mt-1 text-xs text-muted-foreground">
                {count} of {needed} vote{needed === 1 ? "" : "s"}
              </div>
            </div>
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
  onDone,
}: {
  walletAddress: string;
  onDone: () => void;
}) {
  const { canSubmit } = useSubmitTransaction();
  const { castVote } = useMultisigActions({ walletAddress });
  // Two simulations: the proposal tx itself, and the proposal's ultimate
  // effect (target.func(args) executed as the wallet) once votes pass.
  const proposalSim = useSimulation();
  const effectSim = useSimulation();

  const [target, setTarget] = useState("");
  const [showSug, setShowSug] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [selectedFunc, setSelectedFunc] = useState("");
  const [manualFunc, setManualFunc] = useState("");
  const [abiArgs, setAbiArgs] = useState<Record<string, string>>({});
  const [abiArgAddrs, setAbiArgAddrs] = useState<Record<string, string>>({});
  const [manualArgs, setManualArgs] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

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

  const buildArgs = (): string[] => {
    if (useAbi && selectedFunc) {
      return abiFuncArgs.map((a) => {
        const v = (abiArgs[a.name] ?? "").trim();
        if (isPlainAddressType(a.type)) return strip0x(abiArgAddrs[a.name] || v);
        return /address/i.test(a.type) ? strip0x(v) : v;
      });
    }
    return manualArgs.map((a) => a.trim()).filter((a) => a.length > 0);
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
    effectSim.reset();
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
      toast.success("Issue proposed", { description: "Signers can vote on it below." });
      reset();
      onDone();
    } catch (err: any) {
      toast.error("Proposal failed", { description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  // Named {type,value} args for the effect simulation (ABI mode only).
  const buildEffectArgs = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const a of abiFuncArgs) {
      const isAddressArg = isPlainAddressType(a.type);
      const raw = isAddressArg ? abiArgAddrs[a.name] || abiArgs[a.name] : abiArgs[a.name];
      if (raw === undefined || raw === "") continue;
      let parsedValue: unknown = raw;
      if (a.type !== "string" && !isAddressArg) {
        try {
          parsedValue = JSON.parse(raw);
        } catch {
          parsedValue = raw;
        }
      }
      out[a.name] = a.type ? { type: a.type, value: parsedValue } : parsedValue;
    }
    return out;
  };

  const simulate = async () => {
    if (resolvedAddress.length !== 40 || !func) {
      toast.error("Enter a target contract and function first");
      return;
    }
    // 1. The proposal transaction (will my castVoteOnIssue succeed?).
    proposalSim.run("FUNCTION", buildCastVotePayload(walletAddress, func, buildArgs(), resolvedAddress));
    // 2. The proposal's effect, as if the wallet executed it (needs arg names).
    if (useAbi) {
      effectSim.run(
        "FUNCTION",
        {
          contractAddress: resolvedAddress,
          method: func,
          value: 0,
          args: buildEffectArgs(),
          metadata: {},
        },
        { address: walletAddress }
      );
    } else {
      effectSim.reset();
    }
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

      <SimulationResultPanel result={proposalSim.result} error={proposalSim.error} title="Proposal tx" />
      <SimulationResultPanel result={effectSim.result} error={effectSim.error} title="Effect if executed" />
      {(proposalSim.result || proposalSim.error) && !useAbi ? (
        <p className="text-xs text-muted-foreground">
          Effect simulation needs a resolved ABI (pick the function from the contract) to name the
          arguments.
        </p>
      ) : null}

      <div className="flex gap-2">
        {proposalSim.canSimulate ? (
          <SimulateButton
            onClick={simulate}
            pending={proposalSim.pending || effectSim.pending}
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

function TreasuryTab({ wallet }: { wallet: UserWallet }) {
  const { userAddress } = useUser();
  const { canSubmit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const { data: signers = [] } = useSigners(wallet.address);
  const { proposeTransfer } = useMultisigActions({ walletAddress: wallet.address });

  const me = strip0x(userAddress ?? "");
  const iAmSigner = signers.some((s) => eq(s, me));

  const { data: myTokens = [] } = useMyTokens(userAddress); // depositor's balances
  const { data: treasury = [] } = useMyTokens(wallet.address); // multisig's balances

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tokens", userAddress] });
    queryClient.invalidateQueries({ queryKey: ["my-tokens", wallet.address] });
    queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
  };

  return (
    <div className="space-y-6">
      {/* Holdings */}
      <div className="space-y-2">
        <Label>Treasury holdings</Label>
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
        iAmSigner={iAmSigner}
        canSubmit={canSubmit}
        onPropose={proposeTransfer}
        onDone={refresh}
      />
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
