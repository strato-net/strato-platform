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
import { AddrLink } from "@/components/explorer/AddrLink";
import { shortenHex } from "@/lib/utils";
import { useUser } from "@/context/UserContext";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { useMyTokens, type TokenBalance } from "@/services/tokens";
import { useUserSearch } from "@/services/accounts";
import type { UserWallet } from "@/services/userWallets";
import {
  useAdminRegistryLogic,
  useIsMultisig,
  useSigners,
  useOpenIssues,
  useExecutedIssues,
  useMultisigActions,
  votesNeeded,
  bpsToPct,
  pctToBps,
  strip0x,
  isZeroAddr,
  type OpenIssue,
} from "@/services/multisig";

/* --------------------------------------------------------------------------------- */
/* Helpers                                                                            */
/* --------------------------------------------------------------------------------- */

const eq = (a?: string, b?: string) => !!a && !!b && strip0x(a) === strip0x(b);

const isAddressLike = (s: string) => /^(0x)?[0-9a-fA-F]{40}$/.test(s.trim());

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
      return {
        label: `Set threshold to ${bpsToPct(Number(a0) || 0)}%`,
        canonical: [String(Number(a0) || 0)],
      };
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

/** Human label for an issue, formatting `transfer` amounts with token metadata. */
function labelForIssue(
  issue: { func: string; target: string; args: string[] },
  tokenMeta: Map<string, TokenMeta>
): string {
  if (issue.func === "transfer") {
    const meta = tokenMeta.get(strip0x(issue.target));
    const to = issue.args[0] ?? "";
    const raw = issue.args[1] ?? "0";
    const amt = meta ? safeFormatUnits(raw, meta.decimals) : raw;
    const sym = meta?.symbol ?? shortenHex(issue.target, 5, 4);
    return `Transfer ${amt} ${sym} → ${shortenHex(to, 6, 4)}`;
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
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");

  const logicSet = !isZeroAddr(config.logicContract) && eq(config.logicContract, adminLogic);

  const run = async () => {
    if (!me) {
      toast.error("Connect a wallet first");
      return;
    }
    const signers = [me, ...extra];
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
            <div key={i} className="flex items-center gap-2">
              <Input
                value={a}
                onChange={(e) =>
                  setExtra((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                }
                placeholder="0x… additional signer address"
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
            onClick={() => setExtra((prev) => [...prev, ""])}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add signer
          </Button>
          <p className="text-xs text-muted-foreground">
            The default voting threshold is 60%; you can change it once enabled.
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
  const thresholdPct = bpsToPct(config.defaultThresholdBps || 6000);
  const needed = votesNeeded(signers.length, config.defaultThresholdBps || 6000);

  const [newSigner, setNewSigner] = useState("");
  const [thresholdInput, setThresholdInput] = useState(String(thresholdPct));
  const [busy, setBusy] = useState<string>("");

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
    if (strip0x(newSigner).length !== 40) {
      toast.error("Enter a valid address");
      return;
    }
    if (signers.some((s) => eq(s, newSigner))) {
      toast.error("Already a signer");
      return;
    }
    setBusy("add");
    try {
      await addSigner(newSigner);
      toast.success("Vote cast to add signer", { description: "Executes once the threshold is met." });
      setNewSigner("");
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
    const pct = Number(thresholdInput);
    if (!(pct > 0 && pct <= 100)) {
      toast.error("Threshold must be between 1 and 100%");
      return;
    }
    setBusy("threshold");
    try {
      await setDefaultThreshold(pctToBps(pct));
      toast.success("Vote cast to change threshold", {
        description: "Executes once the threshold is met.",
      });
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

      {/* Threshold */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Voting threshold</div>
            <div className="text-xs text-muted-foreground">
              {thresholdPct}% · {needed} of {signers.length} signer{signers.length === 1 ? "" : "s"} required
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">%</span>
          <Button
            size="sm"
            variant="outline"
            onClick={doThreshold}
            disabled={busy !== "" || !canSubmit || !iAmSigner}
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
        <div className="flex items-center gap-2">
          <Input
            id="new-signer"
            value={newSigner}
            onChange={(e) => setNewSigner(e.target.value)}
            placeholder="0x… signer address"
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
  const { castVote, addSigner, removeSigner, swapSigner, setDefaultThreshold, proposeTransfer } =
    useMultisigActions({ walletAddress: wallet.address });

  const me = strip0x(userAddress ?? "");
  const iAmSigner = signers.some((s) => eq(s, me));
  const needed = votesNeeded(signers.length, config.defaultThresholdBps || 6000);
  const [busy, setBusy] = useState<string>("");

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
      queryClient.invalidateQueries({ queryKey: ["multisig-open-issues", wallet.address] });
      queryClient.invalidateQueries({ queryKey: ["multisig-signers", wallet.address] });
      queryClient.invalidateQueries({ queryKey: ["multisig-config", wallet.address] });
    } catch (err: any) {
      toast.error("Vote failed", { description: String(err?.message || err) });
    } finally {
      setBusy("");
    }
  };

  if (isLoading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading issues…</p>;
  }
  if (issues.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No open issues. Proposals you create from the Signers tab appear here for voting.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {issues.map((issue) => {
        const label = labelForIssue(issue, tokenMeta);
        const count = issue.voters.length;
        const iVoted = issue.voters.some((v) => eq(v, me));
        const pct = needed > 0 ? Math.min(100, (count / needed) * 100) : 0;
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
              <Button
                size="sm"
                onClick={() => vote(issue)}
                disabled={busy !== "" || !canSubmit || !iAmSigner || iVoted}
                className="shrink-0"
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

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading history…</p>
      ) : executed.length === 0 && page === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No executed issues yet.</p>
      ) : (
        <div className="space-y-2">
          {executed.map((ex, i) => {
            const label = labelForIssue(ex, tokenMeta);
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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = tokens.find((t) => t.symbol === symbol);

  const searchTerm = isAddressLike(recipient) ? "" : recipient;
  const { data: matches } = useUserSearch(searchTerm);
  const suggestions = useMemo(() => (matches ?? []).slice(0, 6), [matches]);
  const resolvedTo = isAddressLike(recipient) ? strip0x(recipient) : recipientAddress;

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
      <div className="relative space-y-1">
        <Input
          placeholder="Recipient address or username"
          autoComplete="off"
          value={recipient}
          onChange={(e) => {
            const v = e.target.value;
            setRecipient(v);
            setRecipientAddress(isAddressLike(v) ? strip0x(v) : "");
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          className="font-mono text-xs"
        />
        {showSuggestions && suggestions.length > 0 ? (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((u) => (
              <button
                type="button"
                key={u.address}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setRecipient(u.username);
                  setRecipientAddress(u.address);
                  setShowSuggestions(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">{u.username}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {shortenHex(u.address)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {recipientAddress && !isAddressLike(recipient) ? (
          <p className="font-mono text-xs text-muted-foreground">→ {recipientAddress}</p>
        ) : null}
      </div>

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
