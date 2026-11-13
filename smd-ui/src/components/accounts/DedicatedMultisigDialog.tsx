import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, ShieldCheck } from "lucide-react";
import { AddressInput } from "@/components/AddressInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DedicatedHistoryTab,
  DedicatedProtocolActionsTab,
  DedicatedTreasuryTab,
} from "@/components/accounts/DedicatedTreasury";
import { useUser } from "@/context/UserContext";
import { typedVariadicArg } from "@/lib/args";
import { shortenHex } from "@/lib/utils";
import {
  useDedicatedIssues,
  useDedicatedMultisigActions,
  useDedicatedCreatedWallet,
  useDedicatedSetup,
  useDedicatedSetupLifecycle,
  useDedicatedWalletState,
  isUnlimitedTokenApproval,
  parseDedicatedTypedArguments,
  type DedicatedIssue,
  type MultisigWalletSummary,
  useDedicatedFactoryState,
} from "@/services/dedicatedMultisig";
import {
  useCDPMetadata,
  usePoolMetadata,
  useStakingMetadata,
  useV3AllowanceMetadata,
} from "@/services/protocolMetadata";
import { describeProposal, type ProposalMetadata } from "@/services/dedicatedProposal";
import { useMyTokens, useTokenMetadata, type TokenMetadata } from "@/services/tokens";
import { strip0x, useMyUserWallets } from "@/services/userWallets";

const formatRemaining = (seconds: number) => {
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 86400)}d`;
};

function IssueActions({
  wallet,
  issue,
  disabled,
  requiredApprovals,
  tokens,
  metadata,
}: {
  wallet: MultisigWalletSummary;
  issue: DedicatedIssue;
  disabled: boolean;
  requiredApprovals: number;
  tokens: TokenMetadata[];
  metadata: ProposalMetadata;
}) {
  const { userAddress } = useUser();
  const actions = useDedicatedMultisigActions(wallet.address);
  const signerUsername = wallet.signerUsername || undefined;
  const [argumentsJson, setArgumentsJson] = useState(
    JSON.stringify(issue.arguments.map((value, index) => ({ type: issue.argumentTypes[index] ?? "", value })), null, 2)
  );
  const [busy, setBusy] = useState(false);
  const run = async (execute: boolean) => {
    setBusy(true);
    try {
      const { types, args } = parseDedicatedTypedArguments(argumentsJson);
      if (JSON.stringify(types) !== JSON.stringify(issue.argumentTypes)) {
        throw new Error("Argument types do not match the committed proposal");
      }
      if (execute) await actions.executeIssue(issue, args, signerUsername);
      else await actions.approveIssue(issue, args, signerUsername);
      toast.success(execute ? "Proposal executed" : "Proposal approved");
    } catch (error: any) {
      toast.error(error?.message || "Transaction failed");
    } finally {
      setBusy(false);
    }
  };
  const control = async (dismiss: boolean) => {
    setBusy(true);
    try {
      if (dismiss) await actions.dismissIssue(issue.issueId, signerUsername);
      else await actions.revokeIssueApproval(issue.issueId, signerUsername);
      toast.success(dismiss ? "Proposal dismissed" : "Approval revoked");
    } catch (error: any) {
      toast.error(error?.message || "Transaction failed");
    } finally {
      setBusy(false);
    }
  };
  const unlimitedApproval = isUnlimitedTokenApproval(issue.functionName, issue.arguments);
  const me = strip0x(wallet.signerAddress || userAddress || "");
  const approved = issue.approvedSigners.some((signer) => strip0x(signer) === me);
  const creator = strip0x(issue.creator) === me;
  const now = Date.now() / 1000;
  const statusIndex = issue.executableAt === 0 ? 0 : now < issue.executableAt ? 1 : 2;
  const statuses = ["Awaiting approvals", "Waiting period", "Ready to execute", "Executed"];
  const remainingApprovals = Math.max(requiredApprovals - issue.approvals, 0);
  const description = describeProposal(issue, tokens, metadata);

  const cancelQueuedIssue = async () => {
    setBusy(true);
    try {
      await actions.proposeIssue(wallet.address, "cancelIssue", ["string"], [
        typedVariadicArg("string", issue.issueId),
      ], signerUsername);
      toast.success("Proposal created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create cancellation proposal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="text-base font-medium">{description.headline}</div>
      <div className="text-sm text-muted-foreground">
        {issue.approvals} of {requiredApprovals} approvals
        {remainingApprovals > 0 ? ` · waiting for ${remainingApprovals} more` : ""}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {statuses.map((status, index) => (
          <div key={status} className="flex items-center gap-1">
            {index > 0 ? <span className="text-muted-foreground">→</span> : null}
            <Badge variant={index === statusIndex ? "default" : index < statusIndex ? "secondary" : "outline"}>
              {status}
            </Badge>
          </div>
        ))}
      </div>
      {statusIndex === 1 ? (
        <div className="text-xs text-muted-foreground">
          Ready in {formatRemaining(issue.executableAt - now)} · {new Date(issue.executableAt * 1000).toLocaleString()}
        </div>
      ) : null}
      <div>
        <span className="text-muted-foreground">Contract: </span>
        <span className="font-mono break-all">{issue.target}</span>
      </div>
      {description.addresses.map((item) => (
        <div key={`${item.label}:${item.value}`}>
          <span className="text-muted-foreground">{item.label}: </span>
          <span className="font-mono break-all">{item.value}</span>
        </div>
      ))}
      <div className="text-xs text-muted-foreground">
        Approved by: {issue.approvedSigners.length
          ? issue.approvedSigners.map((signer) =>
              `${shortenHex(signer, 6, 4)}${strip0x(signer) === me ? " (you)" : ""}`
            ).join(", ")
          : "No one yet"}
      </div>
      {unlimitedApproval ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unlimited token approval</AlertTitle>
          <AlertDescription>Review the spender and amount carefully before approving.</AlertDescription>
        </Alert>
      ) : null}
      <details className="rounded-md bg-muted/40 p-2">
        <summary className="cursor-pointer font-medium">Technical details</summary>
        <div className="mt-2 space-y-2">
          <div><span className="text-muted-foreground">Function:</span> <span className="font-mono">{issue.functionName}</span></div>
          <div><span className="text-muted-foreground">Types:</span> <span className="font-mono break-all">{JSON.stringify(issue.argumentTypes)}</span></div>
          <div><span className="text-muted-foreground">Arguments:</span> <span className="font-mono break-all">{JSON.stringify(issue.arguments)}</span></div>
          <div className="font-mono text-xs break-all">Proposal {issue.issueId}</div>
          <div className="text-xs text-muted-foreground">Expires {new Date(issue.expiresAt * 1000).toLocaleString()}</div>
          <Label>Exact typed arguments</Label>
          <Textarea value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} className="font-mono text-xs" />
        </div>
      </details>
      <div className="flex gap-2">
        {issue.executableAt === 0 && !approved ? (
          <Button size="sm" disabled={busy || disabled} onClick={() => void run(false)}>Approve</Button>
        ) : null}
        {statusIndex === 2 ? (
          <>
            <Button
              size="sm"
              disabled={busy || disabled}
              onClick={() => void run(true)}
            >
              Execute
            </Button>
          </>
        ) : null}
        {issue.executableAt > 0 ? (
          <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => void cancelQueuedIssue()}>
            Propose cancellation
          </Button>
        ) : null}
        {issue.executableAt === 0 ? (
          <>
            {approved ? (
              <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => void control(false)}>
                Revoke approval
              </Button>
            ) : null}
            {creator && (issue.approvals === 0 || (approved && issue.approvals === 1)) ? (
              <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => void control(true)}>
                Dismiss
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ManageDedicatedMultisig({ wallet }: { wallet: MultisigWalletSummary }) {
  const { data: state, isLoading } = useDedicatedWalletState(wallet.address);
  const { data: issues = [] } = useDedicatedIssues(wallet.address, state?.epoch);
  const { data: walletTokens = [] } = useMyTokens(wallet.address);
  const proposalTokenAddresses = useMemo(
    () => issues.flatMap((issue) => [issue.target, ...issue.arguments]),
    [issues]
  );
  const { data: indexedTokens = [] } = useTokenMetadata(proposalTokenAddresses);
  const tokens = useMemo(
    () => [...walletTokens, ...indexedTokens.filter((indexed) =>
      !walletTokens.some((walletToken) => strip0x(walletToken.address) === strip0x(indexed.address))
    )],
    [indexedTokens, walletTokens]
  );
  const { data: staking } = useStakingMetadata();
  const { data: cdp } = useCDPMetadata();
  const { data: pools = [] } = usePoolMetadata();
  const { data: v3 } = useV3AllowanceMetadata(wallet.address);
  const { data: factoryState } = useDedicatedFactoryState();
  const actions = useDedicatedMultisigActions(wallet.address);
  const signerUsername = wallet.signerUsername || undefined;
  const [target, setTarget] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [argumentsJson, setArgumentsJson] = useState("[]");
  const [upgradeLogic, setUpgradeLogic] = useState("");
  const [upgradeVersion, setUpgradeVersion] = useState("");
  const [migrationFunction, setMigrationFunction] = useState("");
  const [nomineeText, setNomineeText] = useState("");
  const [nominee, setNominee] = useState("");
  const [replaceSigner, setReplaceSigner] = useState("");
  const [removeSigner, setRemoveSigner] = useState("");
  const [newRequiredApprovals, setNewRequiredApprovals] = useState("");
  const [newTimelockHours, setNewTimelockHours] = useState("");
  const [busy, setBusy] = useState(false);
  const proposalMetadata = useMemo<ProposalMetadata>(
    () => ({
      walletAddress: wallet.address,
      signers: state?.signers,
      requiredApprovals: state?.requiredApprovals,
      staking,
      cdp,
      pools,
      v3,
    }),
    [cdp, pools, staking, state?.requiredApprovals, state?.signers, v3, wallet.address]
  );
  const openIssues = issues.filter(
    (issue) => issue.epoch === state?.epoch && issue.expiresAt >= Date.now() / 1000
  );
  const needsApproval = openIssues.filter(
    (issue) => issue.executableAt === 0 &&
      !issue.approvedSigners.some((signer) => strip0x(signer) === strip0x(wallet.signerAddress))
  ).length;
  const ready = openIssues.filter(
    (issue) => issue.executableAt > 0 && issue.executableAt <= Date.now() / 1000
  ).length;
  const [tab, setTab] = useState(
    wallet.pendingSigner ? "settings" : needsApproval + ready ? "issues" : "treasury"
  );
  const proposalCreated = () => setTab("issues");

  const acceptNomination = async () => {
    setBusy(true);
    try {
      await actions.acceptNomination(wallet.nomineeUsername || undefined);
      toast.success("Invitation accepted");
    } catch (error: any) {
      toast.error(error?.message || "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    setBusy(true);
    try {
      const { types, args } = parseDedicatedTypedArguments(argumentsJson);
      await actions.proposeIssue(target, functionName, types, args, signerUsername);
      toast.success("Proposal created");
      proposalCreated();
    } catch (error: any) {
      toast.error(error?.message || "Could not create proposal");
    } finally {
      setBusy(false);
    }
  };

  const executeUpgrade = async () => {
    setBusy(true);
    try {
      await actions.executeUpgrade();
      toast.success("Upgrade applied");
    } catch (error: any) {
      toast.error(error?.message || "Could not apply upgrade");
    } finally {
      setBusy(false);
    }
  };

  const proposeUpgradeControl = async (operation: "schedule" | "cancel" | "freeze") => {
    setBusy(true);
    try {
      if (operation === "schedule") {
        if (!upgradeVersion.trim() || !/^(0x)?[0-9a-f]{40}$/i.test(upgradeLogic)) {
          throw new Error("Select a version");
        }
        if (migrationFunction && !migrationFunction.startsWith("migrate")) {
          throw new Error("Migration function names must begin with migrate");
        }
        await actions.proposeIssue(
          wallet.address,
          "scheduleUpgrade",
          ["address", "string", "string"],
          [
            typedVariadicArg("address", upgradeLogic),
            typedVariadicArg("string", upgradeVersion),
            typedVariadicArg("string", migrationFunction),
          ],
          signerUsername
        );
      } else {
        await actions.proposeIssue(
          wallet.address,
          operation === "cancel" ? "cancelUpgrade" : "freezeUpgrades",
          [],
          [],
          signerUsername
        );
      }
      toast.success("Proposal created");
      proposalCreated();
    } catch (error: any) {
      toast.error(error?.message || "Could not create proposal");
    } finally {
      setBusy(false);
    }
  };

  const proposeConfiguration = async (mode: "nominate" | "remove" | "threshold" | "timelock") => {
    if (!state) return;
    setBusy(true);
    try {
      if (mode === "timelock") {
        if (!/^\d+$/.test(newTimelockHours) || Number(newTimelockHours) > 720) {
          throw new Error("Waiting period must be a whole number from 0 to 720 hours");
        }
        const seconds = String(Number(newTimelockHours) * 3600);
        await actions.proposeIssue(wallet.address, "setTransactionTimelock", ["uint256"], [
          typedVariadicArg("uint256", seconds),
        ], signerUsername);
      } else {
        let signers = [...state.signers];
        const required = mode === "threshold" ? Number(newRequiredApprovals) : state.requiredApprovals;
        let functionName = "applyConfiguration";
        let types = ["address[]", "uint256"];
        let args: unknown[];
        if (mode === "nominate") {
          const normalizedNominee = strip0x(nominee);
          if (!/^[0-9a-f]{40}$/i.test(normalizedNominee)) throw new Error("Enter a valid signer address");
          if (signers.some((signer) => strip0x(signer) === normalizedNominee)) throw new Error("That address is already a signer");
          if (replaceSigner) {
            const replaceIndex = signers.findIndex((signer) => strip0x(signer) === strip0x(replaceSigner));
            if (replaceIndex < 0) throw new Error("Signer to replace is not in the current signer set");
            signers[replaceIndex] = normalizedNominee;
          } else {
            signers.push(normalizedNominee);
          }
          signers.sort();
          functionName = "nominateConfiguration";
          types = ["address", "address[]", "uint256"];
          args = [
            typedVariadicArg("address", normalizedNominee),
            typedVariadicArg("address[]", JSON.stringify(signers)),
            typedVariadicArg("uint256", String(required)),
          ];
        } else {
          if (mode === "remove") {
            signers = signers.filter((signer) => strip0x(signer) !== strip0x(removeSigner));
            if (signers.length === state.signers.length) throw new Error("Signer to remove is not in the current signer set");
          }
          if (!Number.isInteger(required) || required < 2 || required >= signers.length) {
            throw new Error("Approvals needed must be at least 2 and fewer than the number of signers");
          }
          args = [
            typedVariadicArg("address[]", JSON.stringify(signers.sort())),
            typedVariadicArg("uint256", String(required)),
          ];
        }
        await actions.proposeIssue(wallet.address, functionName, types, args, signerUsername);
      }
      toast.success("Proposal created");
      proposalCreated();
    } catch (error: any) {
      toast.error(error?.message || "Could not create proposal");
    } finally {
      setBusy(false);
    }
  };

  const proposeNominationRevocation = async () => {
    const normalizedNominee = strip0x(nominee);
    if (!/^[0-9a-f]{40}$/i.test(normalizedNominee)) {
      toast.error("Enter the invited signer’s address");
      return;
    }
    setBusy(true);
    try {
      await actions.proposeIssue(wallet.address, "revokeNomination", ["address"], [
        typedVariadicArg("address", normalizedNominee),
      ], signerUsername);
      toast.success("Proposal created");
      proposalCreated();
    } catch (error: any) {
      toast.error(error?.message || "Could not create proposal");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !state) return <div className="text-sm text-muted-foreground">Loading multisig wallet…</div>;
  return (
    <div className="space-y-4">
      {state.verified ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Verified multisig wallet</AlertTitle>
          <AlertDescription>Version {state.version} · {state.requiredApprovals} of {state.signers.length} approvals</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {state.verificationErrors.length === 1 &&
            state.verificationErrors.includes("Wallet is not active")
              ? "This multisig wallet is not active yet"
              : "This multisig wallet is not recognised on this network"}
          </AlertTitle>
          <AlertDescription>
            <details>
              <summary className="cursor-pointer">Technical details</summary>
              <div className="mt-1">{state.verificationErrors.join(". ")}</div>
            </details>
          </AlertDescription>
        </Alert>
      )}
      {needsApproval || ready ? (
        <button
          type="button"
          className="w-full rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-left text-sm"
          onClick={() => setTab("issues")}
        >
          {[
            needsApproval ? `${needsApproval} proposal${needsApproval === 1 ? "" : "s"} need your approval` : "",
            ready ? `${ready} ready to execute` : "",
          ].filter(Boolean).join(" · ")}
        </button>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="treasury">Treasury</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="issues">
            Proposals{needsApproval + ready ? ` (${needsApproval + ready})` : ""}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="treasury" className="mt-4">
          <DedicatedTreasuryTab wallet={wallet} disabled={!state.verified} onProposalCreated={proposalCreated} />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <DedicatedProtocolActionsTab wallet={wallet} disabled={!state.verified} onProposalCreated={proposalCreated} />
        </TabsContent>
        <TabsContent value="issues" className="mt-4 space-y-4">
          <details>
            <summary className="cursor-pointer font-medium">Advanced: custom contract call</summary>
            <div className="mt-2 space-y-2">
              <Label>Full target address</Label>
              <Input value={target} onChange={(event) => setTarget(event.target.value)} />
              <Label>Function</Label>
              <Input value={functionName} onChange={(event) => setFunctionName(event.target.value)} />
              <Label>Typed arguments JSON</Label>
              <Textarea
                value={argumentsJson}
                onChange={(event) => setArgumentsJson(event.target.value)}
                placeholder={'[{"type":"address","value":"..."},{"type":"uint256","value":"100"}]'}
                className="font-mono text-xs"
              />
              <Button disabled={busy || !state.verified || !target || !functionName} onClick={() => void propose()}>
                Propose custom call
              </Button>
            </div>
          </details>
          <Separator />
          <div className="space-y-2">
            <div className="font-medium">Open proposals</div>
            {openIssues
              .map((issue) => (
                <IssueActions
                  key={`${issue.issueId}:${JSON.stringify(issue.arguments)}`}
                  wallet={wallet}
                  issue={issue}
                  disabled={!state.verified}
                  requiredApprovals={state.requiredApprovals}
                  tokens={tokens}
                  metadata={proposalMetadata}
                />
              ))}
            {!openIssues.length ? (
              <div className="text-sm text-muted-foreground">No open proposals.</div>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <DedicatedHistoryTab wallet={wallet} tokens={tokens} metadata={proposalMetadata} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-4">
          <div className="grid gap-1 text-sm">
            <div>
              Waiting period: {state.transactionTimelock / 3600}{" "}
              {state.transactionTimelock === 3600 ? "hour" : "hours"}
            </div>
            <div>Upgrades: {state.upgradesFrozen ? "permanently frozen" : "enabled"}</div>
            <div>
              Signers: {state.signers.map((signer) =>
                `${shortenHex(signer, 6, 4)}${strip0x(signer) === strip0x(wallet.signerAddress) ? " (you)" : ""}`
              ).join(", ")}
            </div>
            <details>
              <summary className="cursor-pointer">Advanced</summary>
              <div className="mt-1">Logic: <span className="font-mono break-all">{state.logic}</span></div>
              <div>Epoch: {state.epoch}</div>
            </details>
          </div>
          {wallet.pendingSigner ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Invited signer: <span className="font-mono">{wallet.nomineeAddress}</span>
                {wallet.nomineeUsername ? ` (${wallet.nomineeUsername})` : ""}
              </div>
              <Button disabled={busy || !state.verified} onClick={() => void acceptNomination()}>
                Accept invitation
              </Button>
            </div>
          ) : null}
          <Separator />
          <div className="space-y-2">
            <div className="font-medium">New signer</div>
            <Label>Invited signer</Label>
            <AddressInput
              value={nomineeText}
              resolved={nominee}
              onChange={(text, address) => {
                setNomineeText(text);
                setNominee(address);
              }}
              placeholder="Address or User wallet username"
            />
            <Label>Signer to replace (leave empty to add)</Label>
            <Select
              value={replaceSigner || "none"}
              onValueChange={(value) => setReplaceSigner(value === "none" ? "" : value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Add without replacing</SelectItem>
                {state.signers.map((signer) => (
                  <SelectItem key={signer} value={signer}>{shortenHex(signer, 8, 6)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("nominate")}>
              Propose new signer
            </Button>
            <Button variant="outline" disabled={busy || !state.verified} onClick={() => void proposeNominationRevocation()}>
              Revoke invitation
            </Button>
          </div>
          <div className="space-y-2">
            <div className="font-medium">Remove signer</div>
            <Select value={removeSigner} onValueChange={setRemoveSigner}>
              <SelectTrigger><SelectValue placeholder="Select a signer" /></SelectTrigger>
              <SelectContent>
                {state.signers.map((signer) => (
                  <SelectItem key={signer} value={signer}>{shortenHex(signer, 8, 6)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("remove")}>
              Propose signer removal
            </Button>
          </div>
          <div className="space-y-2">
            <div className="font-medium">Change required approvals</div>
            <Select value={newRequiredApprovals} onValueChange={setNewRequiredApprovals}>
              <SelectTrigger><SelectValue placeholder={`Current: ${state.requiredApprovals}`} /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: Math.max(0, state.signers.length - 2) }, (_, index) => index + 2).map((value) => (
                  <SelectItem key={value} value={String(value)}>{value} of {state.signers.length}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("threshold")}>
              Propose approval change
            </Button>
          </div>
          <div className="space-y-2">
            <div className="font-medium">Change waiting period</div>
            <Input
              value={newTimelockHours}
              onChange={(event) => setNewTimelockHours(event.target.value)}
              inputMode="numeric"
              placeholder="Hours"
            />
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("timelock")}>
              Propose waiting-period change
            </Button>
          </div>
          {!state.upgradesFrozen && !state.pendingUpgrade ? (
            <div className="space-y-2">
              <div className="font-medium">Upgrade multisig wallet</div>
              <Label>New version</Label>
              <Select
                value={upgradeVersion}
                onValueChange={(version) => {
                  setUpgradeVersion(version);
                  setUpgradeLogic(factoryState?.approvedVersions.find((item) => item.version === version)?.logic ?? "");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select an approved version" /></SelectTrigger>
                <SelectContent>
                  {(factoryState?.approvedVersions ?? []).map((version) => (
                    <SelectItem key={version.version} value={version.version}>{version.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {upgradeLogic ? (
                <>
                  <Label>New version address</Label>
                  <div className="font-mono text-xs break-all">{upgradeLogic}</div>
                </>
              ) : null}
              <details>
                <summary className="cursor-pointer text-sm">Advanced</summary>
                <div className="mt-2 space-y-2">
                  <Label>Migration function (must begin with migrate; empty for none)</Label>
                  <Input value={migrationFunction} onChange={(event) => setMigrationFunction(event.target.value)} />
                </div>
              </details>
              <Button disabled={busy || !state.verified} onClick={() => void proposeUpgradeControl("schedule")}>
                Propose upgrade
              </Button>
            </div>
          ) : null}
          {state.pendingUpgrade ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Pending upgrade to version {state.pendingUpgrade.targetVersion}</AlertTitle>
              <AlertDescription className="space-y-2">
                <div>
                  Can be applied from {new Date(state.pendingUpgrade.executableAt * 1000).toLocaleString()} ·
                  expires {new Date(state.pendingUpgrade.expiresAt * 1000).toLocaleString()}
                </div>
                <details>
                  <summary className="cursor-pointer">Advanced</summary>
                  <div className="mt-1 font-mono break-all">
                    New version address: {state.pendingUpgrade.targetLogic}
                  </div>
                  <div>Migration: {state.pendingUpgrade.migrationFunction || "No migration"}</div>
                </details>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !state.verified || Date.now() / 1000 < state.pendingUpgrade.executableAt}
                  onClick={() => void executeUpgrade()}
                >
                  Apply upgrade
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !state.verified}
                  onClick={() => void proposeUpgradeControl("cancel")}
                >
                  Propose cancellation
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {!state.upgradesFrozen ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Permanent upgrade freeze</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>A frozen multisig wallet can never receive security fixes.</p>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !state.verified}
                  onClick={() => void proposeUpgradeControl("freeze")}
                >
                  Propose permanent freeze
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateDedicatedMultisig() {
  const { userAddress } = useUser();
  const { data: userWallets = [] } = useMyUserWallets(userAddress);
  const actions = useDedicatedMultisigActions();
  const { data: factoryState } = useDedicatedFactoryState();
  const [label, setLabel] = useState("");
  const [signerInputs, setSignerInputs] = useState([
    { text: userAddress ?? "", address: strip0x(userAddress ?? "") },
  ]);
  const [required, setRequired] = useState(2);
  const [timelockHours, setTimelockHours] = useState(24);
  const [initialVersion, setInitialVersion] = useState("");
  const [setupHash, setSetupHash] = useState("");
  const [registeredHere, setRegisteredHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("create");
  const invalidSigners = signerInputs.filter((signer) => signer.text.trim() && !signer.address);
  const normalizedSignerEntries = signerInputs.map((signer) => strip0x(signer.address)).filter(Boolean);
  const duplicateSigners = normalizedSignerEntries.length !== new Set(normalizedSignerEntries).size;
  const signers = [...new Set(normalizedSignerEntries.filter((value) => value.length === 40))].sort();
  const configured = factoryState?.verified === true;
  const selectedInitialVersion = initialVersion ||
    factoryState?.approvedVersions[factoryState.approvedVersions.length - 1]?.version || "";
  const { data: setup } = useDedicatedSetup(setupHash);
  const { data: setupLifecycle = "unknown" } = useDedicatedSetupLifecycle(setupHash);
  const { data: createdWallet = "" } = useDedicatedCreatedWallet(
    setupHash,
    setupLifecycle === "deployed"
  );
  const setupPending = setupLifecycle === "pending" && !!setup && setup.expiresAt >= Date.now() / 1000;
  const controlledSigners = [
    { address: strip0x(userAddress ?? ""), username: "" },
    ...userWallets.map((wallet) => ({ address: strip0x(wallet.address), username: wallet.username })),
  ].filter((identity) => identity.address);
  const signingIdentity = controlledSigners.find((identity) =>
    setup?.signers.some((signer) => strip0x(signer) === identity.address)
  );
  const cancellingIdentity = signingIdentity ?? controlledSigners.find(
    (identity) => identity.address === strip0x(setup?.creator ?? "")
  );
  const signerConfirmed = !!signingIdentity && !!setup?.confirmedSigners.some(
    (signer) => strip0x(signer) === signingIdentity.address
  );
  const labelByteLength = new TextEncoder().encode(label).length;
  const validLabel = labelByteLength <= 64;
  const validRequired = Number.isInteger(required) && required >= 2 && required < signers.length;
  const validTimelock = Number.isInteger(timelockHours) && timelockHours >= 0 && timelockHours <= 720;

  const register = async () => {
    setBusy(true);
    try {
      if (!validLabel) throw new Error("Multisig wallet name is too long");
      if (!validRequired) throw new Error("Approvals needed must be at least 2 and fewer than the number of signers");
      if (!validTimelock) throw new Error("Waiting period must be a whole number from 0 to 720 hours");
      await actions.registerSetup({
        signers,
        requiredApprovals: required,
        transactionTimelock: Math.round(timelockHours * 3600),
        initialVersion: selectedInitialVersion,
        label,
      });
      setSetupHash("");
      setRegisteredHere(true);
      setTab("confirm");
      toast.success("Invitation created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create multisig wallet");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await actions.confirmSetup(setupHash, signingIdentity?.username || undefined);
      toast.success("Invitation confirmed");
    } catch (error: any) {
      toast.error(error?.message || "Could not confirm invitation");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await actions.cancelSetup(setupHash, cancellingIdentity?.username || undefined);
      toast.success("Invitation cancelled");
    } catch (error: any) {
      toast.error(error?.message || "Could not cancel invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="create">Create</TabsTrigger>
        <TabsTrigger value="confirm">Confirm</TabsTrigger>
      </TabsList>
      <TabsContent value="create" className="space-y-3">
        {!configured ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {factoryState ? "Multisig wallet creation is not available on this network" : "Checking…"}
            </AlertTitle>
            <AlertDescription>
              {factoryState ? "Multisig wallets are not set up on this network" : ""}
            </AlertDescription>
          </Alert>
        ) : null}
        <Label>Multisig wallet name</Label>
        <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        <p className={`text-xs ${validLabel ? "text-muted-foreground" : "text-destructive"}`}>
          {validLabel
            ? `Visible to everyone and cannot be changed · ${labelByteLength}/64`
            : `Multisig wallet name is too long · ${labelByteLength}/64`}
        </p>
        <Label>Signers</Label>
        <div className="space-y-2">
          {signerInputs.map((signer, index) => (
            <div key={index} className="flex items-start gap-2">
              <AddressInput
                value={signer.text}
                resolved={signer.address}
                onChange={(text, address) => setSignerInputs((current) =>
                  current.map((entry, entryIndex) =>
                    entryIndex === index ? { text, address } : entry
                  )
                )}
                placeholder="Address or User wallet username"
              />
              {signerInputs.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSignerInputs((current) =>
                    current.filter((_, entryIndex) => entryIndex !== index)
                  )}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setSignerInputs((current) => [...current, { text: "", address: "" }])}
          >
            Add signer
          </Button>
        </div>
        {invalidSigners.length ? (
          <p className="text-xs text-destructive">Enter a valid signer address or username.</p>
        ) : duplicateSigners ? (
          <p className="text-xs text-destructive">Signer addresses must be unique.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Approvals needed</Label><Input type="number" min={2} step={1} value={required} onChange={(event) => setRequired(Number(event.target.value))} /></div>
          <div><Label>Waiting period (hours)</Label><Input type="number" min={0} max={720} step={1} value={timelockHours} onChange={(event) => setTimelockHours(Number(event.target.value))} /></div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
          <div className="mt-2 space-y-2">
            <Label>Multisig wallet version</Label>
            <Select value={selectedInitialVersion} onValueChange={setInitialVersion}>
              <SelectTrigger><SelectValue placeholder="Select an approved version" /></SelectTrigger>
              <SelectContent>
                {(factoryState?.approvedVersions ?? []).map((version) => (
                  <SelectItem key={version.version} value={version.version}>{version.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </details>
        <Button
          disabled={busy || !configured || invalidSigners.length > 0 || duplicateSigners ||
            !validLabel || signers.length < 3 || !validRequired || !validTimelock || !selectedInitialVersion}
          onClick={() => void register()}
        >
          Create multisig wallet
        </Button>
      </TabsContent>
      <TabsContent value="confirm" className="space-y-3">
        {!setup && !registeredHere ? (
          <>
            <p className="text-sm text-muted-foreground">
              Enter an invitation code to review and confirm a multisig wallet.
            </p>
            <Label>Invitation code</Label>
            <Input
              value={setupHash}
              onChange={(event) => setSetupHash(event.target.value)}
              className="font-mono"
            />
          </>
        ) : null}
        {!setup && registeredHere ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">Invitation created</div>
            <div className="mt-1 text-muted-foreground">
              Review it under Pending invitations to confirm or share it with the other signers.
            </div>
          </div>
        ) : null}
        {setup ? (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="font-medium">{setup.label || "Unnamed multisig wallet"}</div>
            <Badge variant="outline">
              {setupPending ? "Waiting for signers" : setupLifecycle === "deployed" ? "Created" : "Invitation unavailable"}
            </Badge>
            {createdWallet ? (
              <div className="font-mono text-xs break-all">
                Multisig wallet address: {createdWallet}
              </div>
            ) : null}
            <div className="font-mono text-xs break-all">Invitation code: {setupHash}</div>
            <div>Signer confirmation: {setup.confirmedSigners.length} of {setup.signers.length}</div>
            <div className="font-mono text-xs break-all">Created by: {setup.creator}</div>
            {setupLifecycle !== "deployed" ? (
              <Alert>
                <AlertTitle>Waiting for signer confirmations</AlertTitle>
                <AlertDescription>
                  The multisig wallet address will be available after every signer confirms.
                </AlertDescription>
              </Alert>
            ) : null}
            <div>
              Waiting period: {setup.transactionTimelock / 3600}{" "}
              {setup.transactionTimelock === 3600 ? "hour" : "hours"}
            </div>
            <div>Invitation expires: {new Date(setup.expiresAt * 1000).toLocaleString()}</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {setup.signers.map((signer) => {
                const controlled = controlledSigners.find(
                  (identity) => identity.address === strip0x(signer)
                );
                const confirmed = setup.confirmedSigners.some(
                  (confirmedSigner) => strip0x(confirmedSigner) === strip0x(signer)
                );
                return (
                  <div key={signer} className="font-mono break-all">
                    {confirmed ? "✓" : "○"} {signer}
                    {controlled ? ` (${controlled.username ? `${controlled.username}, you` : "you"})` : ""}
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSetupHash("");
                setRegisteredHere(false);
              }}
            >
              Use another invitation code
            </Button>
          </div>
        ) : null}
        {setup && signingIdentity ? (
          <div className="text-sm">Sign as: {signingIdentity.username || "Connected account"}</div>
        ) : null}
        {setup ? (
          <div className="flex gap-2">
            {signingIdentity && !signerConfirmed ? (
              <Button disabled={busy || !configured || !setupPending} onClick={() => void confirm()}>
                Confirm invitation
              </Button>
            ) : null}
            {cancellingIdentity ? (
              <Button variant="outline" disabled={busy || !configured || !setupPending} onClick={() => void cancel()}>
                Cancel invitation
              </Button>
            ) : null}
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

export function DedicatedMultisigDialog({
  wallet,
}: {
  wallet?: MultisigWalletSummary;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={wallet ? "sm" : "default"} variant={wallet ? "outline" : "default"}>
          {wallet ? <ShieldCheck className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {wallet ? "Manage" : "Create multisig wallet"}
        </Button>
      </DialogTrigger>
      <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none border-0 p-4 md:p-8">
        <DialogHeader>
          <DialogTitle>{wallet ? "Multisig wallet" : "Create multisig wallet"}</DialogTitle>
          <DialogDescription>
            {wallet
              ? "Review and approve proposals, and manage signers."
              : "Create a multisig wallet managed by the signers you choose."}
          </DialogDescription>
        </DialogHeader>
        {wallet ? (
          <ManageDedicatedMultisig wallet={wallet} />
        ) : (
          <CreateDedicatedMultisig />
        )}
      </DialogContent>
    </Dialog>
  );
}
