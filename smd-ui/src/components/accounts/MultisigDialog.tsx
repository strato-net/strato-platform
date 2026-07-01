import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users, Plus, X, ShieldCheck, AlertTriangle, Check, Vote } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/CopyButton";
import { AddrLink } from "@/components/explorer/AddrLink";
import { shortenHex } from "@/lib/utils";
import { useUser } from "@/context/UserContext";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
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
    case "callContract":
      return { label: `Call ${shortenHex(a0, 6, 4)}·${args[1] ?? ""}`, canonical: args };
    default:
      return { label: func || "(unknown)", canonical: args };
  }
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
    <Tabs defaultValue="signers" className="mt-1">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="signers">Signers</TabsTrigger>
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
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
  const { castVote, addSigner, removeSigner, swapSigner, setDefaultThreshold } =
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
        const { label } = describeIssue(issue.func, issue.args);
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

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading history…</p>
      ) : executed.length === 0 && page === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No executed issues yet.</p>
      ) : (
        <div className="space-y-2">
          {executed.map((ex, i) => {
            const { label } = describeIssue(ex.func, ex.args);
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
