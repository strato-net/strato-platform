import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, ShieldCheck } from "lucide-react";
import { AddressInput } from "@/components/AddressInput";
import { CopyableAddress } from "@/components/CopyButton";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DedicatedHistoryTab,
  DedicatedProtocolActionsTab,
  DedicatedTreasuryTab,
} from "@/components/accounts/DedicatedTreasury";
import { useUser } from "@/context/UserContext";
import { typedVariadicArg } from "@/lib/args";
import { formatDateTime, formatWaitingPeriod } from "@/lib/utils";
import {
  useDedicatedIssues,
  useDedicatedMultisigActions,
  useDedicatedWalletState,
  isUnlimitedTokenApproval,
  parseDedicatedTypedArguments,
  type DedicatedIssue,
  type MultisigWalletSummary,
  useDedicatedCallCheck,
  useDedicatedFactoryState,
  WALLET_NOT_ACTIVE,
} from "@/services/dedicatedMultisig";
import {
  useCDPMetadata,
  usePoolMetadata,
  useStakingMetadata,
  useV3AllowanceMetadata,
} from "@/services/protocolMetadata";
import {
  canonicalSolidityType,
  describeProposal,
  describeProposalSideEffect,
  describeProposalWarning,
  knownAddressName,
  proposalArgumentTypesMatch,
  type ProposalMetadata,
} from "@/services/dedicatedProposal";
import { useFunctionByAddress } from "@/services/contracts";
import { useTokenMetadata, type TokenMetadata } from "@/services/tokens";
import { strip0x } from "@/services/userWallets";

/** A labelled group of related settings. */
function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}

/** One discrete action: what it does, its inputs and its button. */
function ActionCard({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="font-medium">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

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
  transactionTimelock,
  cancellationProposed,
  tokens,
  metadata,
}: {
  wallet: MultisigWalletSummary;
  issue: DedicatedIssue;
  disabled: boolean;
  cancellationProposed: boolean;
  requiredApprovals: number;
  transactionTimelock: number;
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
  const proposalWarning = describeProposalWarning(issue);
  const sideEffect = describeProposalSideEffect(issue, wallet.address);
  const customCall = description.custom === true;
  // Token names load after the first render, so the default follows the description until the signer toggles it.
  const [detailsToggled, setDetailsToggled] = useState<boolean | null>(null);
  const detailsOpen = detailsToggled ?? customCall;
  const { data: contractFunction, isLoading: functionLoading, isError: functionError } =
    useFunctionByAddress(issue.target, issue.functionName);
  const expectedAbiTypes = contractFunction?.args.map(
    (argument) => canonicalSolidityType(argument.abiType || argument.type)
  ) ?? [];
  const committedTypes = issue.argumentTypes.map(canonicalSolidityType);
  const argumentTypesMismatch = contractFunction?.found === true &&
    !proposalArgumentTypesMatch(expectedAbiTypes, committedTypes);
  const targetIsWallet = strip0x(issue.target) === strip0x(wallet.address);
  const isUpgradeProposal = targetIsWallet && issue.functionName === "scheduleUpgrade";
  const upgradeVersionApproved = metadata.approvedVersions?.some(
    (version) => version.version === issue.arguments[1] &&
      strip0x(version.logic) === strip0x(issue.arguments[0] ?? "")
  );
  const upgradePathApproved = metadata.approvedUpgradePaths?.some(
    (path) => path.fromVersion === metadata.currentVersion && path.toVersion === issue.arguments[1]
  );
  const upgradeUnavailable = isUpgradeProposal && metadata.approvedVersions !== undefined &&
    (!upgradeVersionApproved || !upgradePathApproved);
  const finalApproval = issue.executableAt === 0 && !approved &&
    issue.approvals + 1 >= requiredApprovals;
  const executesOnApproval = finalApproval && (
    transactionTimelock === 0 ||
    (targetIsWallet && (
      issue.functionName === "cancelIssue" ||
      issue.functionName === "cancelUpgrade" ||
      issue.functionName === "revokeNomination"
    ))
  );
  const verificationPending = functionLoading ||
    (isUpgradeProposal && metadata.approvedVersions === undefined);
  const approvalBlocked = verificationPending || argumentTypesMismatch || upgradeUnavailable;

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

  const named = (value: string) => {
    const name = knownAddressName(value, tokens, metadata);
    return (
      <>
        {name ? <span className="mr-2">{name}</span> : null}
        <CopyableAddress value={value} className={name ? "text-xs text-muted-foreground" : undefined} />
      </>
    );
  };
  const blocked = (issue.executableAt === 0 && !approved) || statusIndex === 2;
  // When this signer's next click would run it, ask the target contract whether it would succeed.
  const check = useDedicatedCallCheck(wallet.address, (finalApproval || statusIndex === 2) && !disabled ? {
    target: issue.target,
    functionName: issue.functionName,
    argumentTypes: issue.argumentTypes,
    arguments: issue.arguments.map((value, index) => typedVariadicArg(issue.argumentTypes[index] ?? "", value)),
  } : null);

  return (
    <div className="space-y-3 rounded-lg border p-4 text-sm">
      <div className="space-y-1">
        <div className="text-base font-medium">{description.headline}</div>
        {description.detail ? (
          <div className="text-muted-foreground">{description.detail}</div>
        ) : null}
        {sideEffect ? <div className="text-muted-foreground">{sideEffect}</div> : null}
      </div>

      <div className="space-y-1 rounded-md bg-muted/40 p-3">
        <div className="text-xs font-medium text-muted-foreground">What it does</div>
        <div><span className="text-muted-foreground">Contract: </span>{named(issue.target)}</div>
        {description.addresses.map((item) => (
          <div key={`${item.label}:${item.value}`}>
            <span className="text-muted-foreground">{item.label}: </span>{named(item.value)}
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-md bg-muted/40 p-3">
        <div className="text-xs font-medium text-muted-foreground">Progress</div>
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
        <div>
          {issue.approvals} of {requiredApprovals} approvals
          {remainingApprovals > 0 ? ` · waiting for ${remainingApprovals} more` : ""}
        </div>
        {statusIndex === 1 ? (
          <div>Ready in {formatRemaining(issue.executableAt - now)} · {formatDateTime(issue.executableAt)}</div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>Proposed by</span>
          <CopyableAddress value={issue.creator} />
          {creator ? <span>(you)</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>Approved by</span>
          {issue.approvedSigners.length ? issue.approvedSigners.map((signer) => (
            <span key={signer} className="inline-flex items-center gap-1">
              <CopyableAddress value={signer} />
              {strip0x(signer) === me ? <span>(you)</span> : null}
            </span>
          )) : <span>no one yet</span>}
        </div>
        <div className="text-xs text-muted-foreground">Expires {formatDateTime(issue.expiresAt)}</div>
      </div>

      {unlimitedApproval ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unlimited token approval</AlertTitle>
          <AlertDescription>Review the spender and amount carefully before approving.</AlertDescription>
        </Alert>
      ) : null}
      {proposalWarning ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{proposalWarning.title}</AlertTitle>
          <AlertDescription>{proposalWarning.detail}</AlertDescription>
        </Alert>
      ) : null}
      {argumentTypesMismatch ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Argument types do not match the target contract</AlertTitle>
          <AlertDescription>
            Expected {JSON.stringify(expectedAbiTypes)}, but this proposal declares {JSON.stringify(committedTypes)}.
            It cannot be approved or executed here.
          </AlertDescription>
        </Alert>
      ) : null}
      {upgradeUnavailable ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Upgrade is no longer available</AlertTitle>
          <AlertDescription>
            The version or upgrade path is not currently approved, so it cannot be approved or executed here.
          </AlertDescription>
        </Alert>
      ) : null}
      {!functionLoading && (functionError || contractFunction?.found === false) ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This contract could not be checked</AlertTitle>
          <AlertDescription>Review the function, argument types and values carefully before approving.</AlertDescription>
        </Alert>
      ) : null}
      {check.data ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This would fail right now</AlertTitle>
          <AlertDescription>The contract would refuse it: {check.data}</AlertDescription>
        </Alert>
      ) : null}
      {executesOnApproval ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This approval executes the proposal</AlertTitle>
          <AlertDescription>
            You are providing the final approval, so this action runs immediately and cannot be revoked first.
          </AlertDescription>
        </Alert>
      ) : null}
      <details
        className="rounded-md bg-muted/40 p-2"
        open={detailsOpen}
        onToggle={(event) => {
          if (event.currentTarget.open !== detailsOpen) setDetailsToggled(event.currentTarget.open);
        }}
      >
        <summary className="cursor-pointer font-medium">Technical details</summary>
        <div className="mt-2 space-y-2">
          <div><span className="text-muted-foreground">Contract:</span> <span className="font-mono text-xs break-all">0x{strip0x(issue.target)}</span></div>
          <div><span className="text-muted-foreground">Function:</span> <span className="font-mono">{issue.functionName}</span></div>
          <div><span className="text-muted-foreground">Types:</span> <span className="font-mono break-all">{JSON.stringify(issue.argumentTypes)}</span></div>
          <div><span className="text-muted-foreground">Arguments:</span> <span className="font-mono break-all">{JSON.stringify(issue.arguments)}</span></div>
          <div><span className="text-muted-foreground">Configuration number:</span> <span className="font-mono">{issue.epoch}</span></div>
          <div><span className="text-muted-foreground">Proposal number:</span> <span className="font-mono">{issue.nonce}</span></div>
          <div><span className="text-muted-foreground">Proposal ID:</span> <span className="font-mono text-xs break-all">{issue.issueId}</span></div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">Advanced: arguments to submit</summary>
            <div className="mt-2 space-y-1">
              <div className="text-xs text-muted-foreground">
                These are sent with your approval and must match the proposal exactly. Change them only if they failed to load.
              </div>
              <Textarea value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} className="font-mono text-xs" />
            </div>
          </details>
        </div>
      </details>
      {verificationPending && blocked ? (
        <div className="text-xs text-muted-foreground">Checking this proposal before it can be approved or executed…</div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {issue.executableAt === 0 && !approved ? (
          <Button size="sm" disabled={busy || disabled || approvalBlocked} onClick={() => void run(false)}>
            {executesOnApproval ? "Approve and execute" : "Approve"}
          </Button>
        ) : null}
        {statusIndex === 2 ? (
          <>
            <Button
              size="sm"
              disabled={busy || disabled || approvalBlocked}
              onClick={() => void run(true)}
            >
              Execute
            </Button>
          </>
        ) : null}
        {issue.executableAt > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || disabled || cancellationProposed}
            onClick={() => void cancelQueuedIssue()}
          >
            {cancellationProposed ? "Cancellation proposed" : "Propose cancellation"}
          </Button>
        ) : null}
        {approved ? (
          <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => void control(false)}>
            Revoke approval
          </Button>
        ) : null}
        {issue.executableAt === 0 && creator && (issue.approvals === 0 || (approved && issue.approvals === 1)) ? (
          <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => void control(true)}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ManageDedicatedMultisig({ wallet }: { wallet: MultisigWalletSummary }) {
  const { data: state, isLoading } = useDedicatedWalletState(wallet.address);
  const { data: issues = [] } = useDedicatedIssues(wallet.address, state?.epoch);
  const proposalTokenAddresses = useMemo(
    () => issues.flatMap((issue) => [issue.target, ...issue.arguments]),
    [issues]
  );
  const { data: tokens = [] } = useTokenMetadata(proposalTokenAddresses);
  const { data: staking } = useStakingMetadata();
  const { data: cdp } = useCDPMetadata();
  const { data: pools = [] } = usePoolMetadata();
  const { data: v3 } = useV3AllowanceMetadata(wallet.address);
  const { data: factoryState, isLoading: factoryLoading } = useDedicatedFactoryState();
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
  const [newRequiredApprovals, setNewRequiredApprovals] = useState("");
  const [newTimelock, setNewTimelock] = useState("");
  const [timelockUnit, setTimelockUnit] = useState("hours");
  const [busy, setBusy] = useState(false);
  const proposalMetadata = useMemo<ProposalMetadata>(
    () => ({
      walletAddress: wallet.address,
      signers: state?.signers,
      requiredApprovals: state?.requiredApprovals,
      currentVersion: state?.version,
      approvedVersions: factoryLoading ? undefined : factoryState?.approvedVersions ?? [],
      approvedUpgradePaths: factoryLoading ? undefined : factoryState?.approvedUpgradePaths ?? [],
      staking,
      cdp,
      pools,
      v3,
    }),
    [
      cdp,
      factoryLoading,
      factoryState?.approvedUpgradePaths,
      factoryState?.approvedVersions,
      pools,
      staking,
      state?.requiredApprovals,
      state?.signers,
      state?.version,
      v3,
      wallet.address,
    ]
  );
  const now = Date.now() / 1000;
  const openIssues = issues.filter(
    (issue) => issue.epoch === state?.epoch && issue.expiresAt >= now
  ).sort((a, b) => a.nonce - b.nonce);
  const needsApproval = openIssues.filter(
    (issue) => issue.executableAt === 0 &&
      !issue.approvedSigners.some((signer) => strip0x(signer) === strip0x(wallet.signerAddress))
  ).length;
  const ready = openIssues.filter(
    (issue) => issue.executableAt > 0 && issue.executableAt <= now
  ).length;
  const approvedUpgradeVersions = (factoryState?.approvedVersions ?? []).filter(
    (version) => version.version !== state?.version &&
      factoryState?.approvedUpgradePaths.some(
        (path) => path.fromVersion === state?.version && path.toVersion === version.version
      )
  );
  const pendingUpgradeExpired = !!state?.pendingUpgrade && state.pendingUpgrade.expiresAt < now;
  const signerCount = state?.signers.length ?? 0;
  const removalBlocked = signerCount <= 3
    ? "A multisig wallet needs at least three signers, so none can be removed."
    : (state?.requiredApprovals ?? 0) >= signerCount - 1
      ? "Lower the approvals needed before removing a signer: they must be fewer than the remaining signers."
      : "";
  const approvalChoices = Array.from({ length: Math.max(0, signerCount - 2) }, (_, index) => index + 2)
    .filter((value) => value !== state?.requiredApprovals);
  const cancelUpgradeProposed = openIssues.some(
    (issue) => strip0x(issue.target) === strip0x(wallet.address) && issue.functionName === "cancelUpgrade"
  );
  const pendingUpgradeAvailable = !!state?.pendingUpgrade && approvedUpgradeVersions.some(
    (version) => version.version === state.pendingUpgrade?.targetVersion &&
      strip0x(version.logic) === strip0x(state.pendingUpgrade?.targetLogic ?? "")
  );
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
        const selectedUpgrade = approvedUpgradeVersions.find(
          (version) => version.version === upgradeVersion && strip0x(version.logic) === strip0x(upgradeLogic)
        );
        if (!selectedUpgrade || !/^(0x)?[0-9a-f]{40}$/i.test(upgradeLogic)) {
          throw new Error("Select a version");
        }
        if (migrationFunction && (!migrationFunction.startsWith("migrate") || migrationFunction.includes("("))) {
          throw new Error("Enter a plain migration function name beginning with migrate");
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

  const proposeConfiguration = async (mode: "nominate" | "remove" | "threshold" | "timelock", removeSigner = "") => {
    if (!state) return;
    setBusy(true);
    try {
      if (mode === "timelock") {
        const waitingSeconds = Number(newTimelock) * (timelockUnit === "days" ? 86400 : 3600);
        if (!/^\d+$/.test(newTimelock) || waitingSeconds > 2592000) {
          throw new Error("Waiting period must be a whole number of hours or days, up to 30 days");
        }
        const seconds = String(waitingSeconds);
        await actions.proposeIssue(wallet.address, "setTransactionTimelock", ["uint256"], [
          typedVariadicArg("uint256", seconds),
        ], signerUsername);
      } else if (mode === "nominate") {
        const normalizedNominee = strip0x(nominee);
        if (!/^[0-9a-f]{40}$/i.test(normalizedNominee)) throw new Error("Enter a valid signer address");
        if (state.signers.some((signer) => strip0x(signer) === normalizedNominee)) throw new Error("That address is already a signer");
        await actions.proposeIssue(wallet.address, "nominateSigner", ["address"], [
          typedVariadicArg("address", normalizedNominee),
        ], signerUsername);
      } else {
        const remove = mode === "remove";
        if (remove && !state.signers.some((signer) => strip0x(signer) === strip0x(removeSigner))) {
          throw new Error("Select a signer to remove");
        }
        const signerCount = state.signers.length - (remove ? 1 : 0);
        if (signerCount < 3) throw new Error("A multisig wallet needs at least three signers");
        const required = remove ? state.requiredApprovals : Number(newRequiredApprovals);
        if (!Number.isInteger(required) || required < 2 || required >= signerCount) {
          throw new Error(remove
            ? "Lower the approvals needed first: they must be fewer than the remaining signers"
            : "Approvals needed must be at least 2 and fewer than the number of signers");
        }
        await actions.proposeIssue(
          wallet.address,
          remove ? "removeSigner" : "setRequiredApprovals",
          remove ? ["address", "uint256"] : ["uint256"],
          [
            ...(remove ? [typedVariadicArg("address", strip0x(removeSigner))] : []),
            typedVariadicArg("uint256", String(required)),
          ],
          signerUsername
        );
      }
      toast.success("Proposal created");
      setNomineeText("");
      setNominee("");
      setNewRequiredApprovals("");
      setNewTimelock("");
      proposalCreated();
    } catch (error: any) {
      toast.error(error?.message || "Could not create proposal");
    } finally {
      setBusy(false);
    }
  };

  const proposeNominationRevocation = async (invited: string) => {
    const normalizedNominee = strip0x(invited);
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
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="text-xl font-semibold">{wallet.label || "Unnamed multisig wallet"}</div>
            <CopyableAddress value={wallet.address} className="text-sm text-muted-foreground" />
          </div>
          {state.provenanceVerified ? (
            <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Verified</Badge>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-xs text-muted-foreground">Approvals needed</div>
            <div className="font-medium">{state.requiredApprovals} of {state.signers.length}</div>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-xs text-muted-foreground">Waiting period</div>
            <div className="font-medium capitalize">{formatWaitingPeriod(state.transactionTimelock)}</div>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <div className="text-xs text-muted-foreground">Version</div>
            <div className="font-medium">{state.version}</div>
          </div>
        </div>
      </div>
      {!state.provenanceVerified ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {state.verificationErrors.length === 1 &&
            state.verificationErrors.includes(WALLET_NOT_ACTIVE)
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
      ) : null}
      {state.provenanceVerified && !state.verified ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Version {state.version} has been retired</AlertTitle>
          <AlertDescription>
            {state.upgradesFrozen
              ? "Upgrades are frozen on this multisig wallet, so it cannot move to a newer version. It keeps working; consider moving funds to a new multisig wallet."
              : approvedUpgradeVersions.length
                ? "This multisig wallet keeps working. An upgrade is available under Admin."
                : "This multisig wallet keeps working. No upgrade is available yet."}
          </AlertDescription>
        </Alert>
      ) : null}
      {state.pendingNominees.length ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Pending signer invitation</AlertTitle>
          <AlertDescription className="space-y-1">
            {state.pendingNominees.map((invited) => (
              <div key={invited}><CopyableAddress value={invited} /></div>
            ))}
            <div>Acceptance will cancel every open proposal and any pending upgrade.</div>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.pendingUpgrade ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {pendingUpgradeExpired ? "Expired" : "Pending"} upgrade to version {state.pendingUpgrade.targetVersion}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <div>
              Can be applied from {formatDateTime(state.pendingUpgrade.executableAt)}
              {now < state.pendingUpgrade.executableAt
                ? ` (in ${formatRemaining(state.pendingUpgrade.executableAt - now)})`
                : ""} ·
              expires {formatDateTime(state.pendingUpgrade.expiresAt)}
            </div>
            <div>Applying it cancels every open proposal and any pending signer invitation.</div>
            {!factoryLoading && !pendingUpgradeAvailable ? (
              <div>The version or upgrade path is no longer approved.</div>
            ) : null}
            <details>
              <summary className="cursor-pointer">Advanced</summary>
              <div className="mt-1">
                New version address: <CopyableAddress value={state.pendingUpgrade.targetLogic} />
              </div>
              <div>Migration: {state.pendingUpgrade.migrationFunction || "No migration"}</div>
            </details>
            {!pendingUpgradeExpired ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  busy ||
                  !state.provenanceVerified ||
                  factoryLoading ||
                  !pendingUpgradeAvailable ||
                  now < state.pendingUpgrade.executableAt
                }
                onClick={() => void executeUpgrade()}
              >
                Apply upgrade
              </Button>
            ) : (
              <div>Select an approved replacement under Admin.</div>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !state.provenanceVerified || cancelUpgradeProposed}
              onClick={() => void proposeUpgradeControl("cancel")}
            >
              {cancelUpgradeProposed ? "Cancellation proposed" : "Propose cancellation"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {needsApproval || ready ? (
        <button
          type="button"
          className="w-full rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-left text-sm"
          onClick={() => setTab("issues")}
        >
          {[
            needsApproval ? `${needsApproval} proposal${needsApproval === 1 ? " needs" : "s need"} your approval` : "",
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
          <TabsTrigger value="settings">Admin</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="treasury" className="mt-4">
          <DedicatedTreasuryTab wallet={wallet} disabled={!state.provenanceVerified} onProposalCreated={proposalCreated} />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <DedicatedProtocolActionsTab wallet={wallet} disabled={!state.provenanceVerified} onProposalCreated={proposalCreated} />
        </TabsContent>
        <TabsContent value="issues" className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Open proposals</div>
            {openIssues
              .map((issue) => (
                <IssueActions
                  key={`${issue.issueId}:${JSON.stringify(issue.arguments)}`}
                  wallet={wallet}
                  issue={issue}
                  disabled={!state.provenanceVerified}
                  requiredApprovals={state.requiredApprovals}
                  transactionTimelock={state.transactionTimelock}
                  cancellationProposed={openIssues.some(
                    (open) => strip0x(open.target) === strip0x(wallet.address) &&
                      open.functionName === "cancelIssue" && open.arguments[0] === issue.issueId
                  )}
                  tokens={tokens}
                  metadata={proposalMetadata}
                />
              ))}
            {!openIssues.length ? (
              <div className="text-sm text-muted-foreground">No open proposals.</div>
            ) : null}
          </div>
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">New custom proposal</summary>
            <div className="mt-1 text-sm text-muted-foreground">
              Call any function on any contract. Use this only when no guided action fits.
            </div>
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
              <Button disabled={busy || !state.provenanceVerified || !target || !functionName} onClick={() => void propose()}>
                Propose custom call
              </Button>
            </div>
          </details>
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <DedicatedHistoryTab wallet={wallet} tokens={tokens} metadata={proposalMetadata} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-6">
          {wallet.pendingSigner ? (
            <ActionCard
              title="You are invited to become a signer"
              description="Accepting cancels every open proposal and any pending upgrade on this multisig wallet."
            >
              <div className="text-sm">
                <CopyableAddress value={wallet.nomineeAddress ?? ""} />
                {wallet.nomineeUsername ? ` (${wallet.nomineeUsername})` : ""}
              </div>
              <Button disabled={busy || !state.provenanceVerified} onClick={() => void acceptNomination()}>
                Accept invitation
              </Button>
            </ActionCard>
          ) : null}

          <SettingsGroup title="Signers">
            <div className="divide-y rounded-lg border">
              {state.signers.map((signer) => (
                <div key={signer} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    <CopyableAddress value={signer} />
                    {strip0x(signer) === strip0x(wallet.signerAddress) ? <span className="ml-2 text-muted-foreground">you</span> : null}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !state.provenanceVerified || !!removalBlocked}
                    onClick={() => void proposeConfiguration("remove", signer)}
                  >
                    Propose removal
                  </Button>
                </div>
              ))}
              {state.pendingNominees.map((invited) => (
                <div key={invited} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    <CopyableAddress value={invited} />
                    <span className="ml-2 text-muted-foreground">invited, not yet accepted</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !state.provenanceVerified}
                    onClick={() => void proposeNominationRevocation(invited)}
                  >
                    Propose withdrawal
                  </Button>
                </div>
              ))}
              {removalBlocked ? (
                <div className="px-4 py-2 text-xs text-muted-foreground">{removalBlocked}</div>
              ) : null}
            </div>
            <ActionCard
              title="Add a signer"
              description={`The invited account must accept within 30 days. Approvals needed stays at ${state.requiredApprovals}.`}
            >
              <AddressInput
                value={nomineeText}
                resolved={nominee}
                onChange={(text, address) => {
                  setNomineeText(text);
                  setNominee(address);
                }}
                placeholder="Address or User wallet username"
              />
              <Button
                disabled={busy || !state.provenanceVerified || !nominee}
                onClick={() => void proposeConfiguration("nominate")}
              >
                Propose new signer
              </Button>
            </ActionCard>
          </SettingsGroup>

          <SettingsGroup title="Rules">
            <ActionCard
              title="Approvals needed"
              description={`Currently ${state.requiredApprovals} of ${state.signers.length}.${
                approvalChoices.length ? "" : " Add a signer before this can change."
              }`}
            >
              {approvalChoices.length ? (
                <>
                  <Select value={newRequiredApprovals} onValueChange={setNewRequiredApprovals}>
                    <SelectTrigger><SelectValue placeholder="Select a new value" /></SelectTrigger>
                    <SelectContent>
                      {approvalChoices.map((value) => (
                        <SelectItem key={value} value={String(value)}>{value} of {state.signers.length}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={busy || !state.provenanceVerified || !newRequiredApprovals}
                    onClick={() => void proposeConfiguration("threshold")}
                  >
                    Propose approval change
                  </Button>
                </>
              ) : null}
            </ActionCard>
            <ActionCard
              title="Waiting period"
              description={`Currently ${formatWaitingPeriod(state.transactionTimelock)}. Up to 30 days; the change itself waits out the current period.`}
            >
              <div className="flex gap-2">
                <Input
                  value={newTimelock}
                  onChange={(event) => setNewTimelock(event.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  className="w-24"
                />
                <Select value={timelockUnit} onValueChange={setTimelockUnit}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">hours</SelectItem>
                    <SelectItem value="days">days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={busy || !state.provenanceVerified || !newTimelock}
                onClick={() => void proposeConfiguration("timelock")}
              >
                Propose waiting-period change
              </Button>
            </ActionCard>
          </SettingsGroup>

          <SettingsGroup title="Version">
            <ActionCard
              title="Upgrade"
              description={
                state.upgradesFrozen
                  ? "Upgrades are permanently frozen on this multisig wallet."
                  : state.pendingUpgrade && !pendingUpgradeExpired
                    ? `An upgrade to version ${state.pendingUpgrade.targetVersion} is pending.`
                    : approvedUpgradeVersions.length
                      ? `On version ${state.version}. An upgrade takes the waiting period plus the upgrade delay.`
                      : factoryLoading
                        ? "Checking for upgrades…"
                        : state.verified
                          ? "This multisig wallet is on the latest version."
                          : "No upgrade is available yet."
              }
            >
              {!state.upgradesFrozen && (!state.pendingUpgrade || pendingUpgradeExpired) && approvedUpgradeVersions.length ? (
                <>
                  <Select
                    value={upgradeVersion}
                    onValueChange={(version) => {
                      setUpgradeVersion(version);
                      setUpgradeLogic(approvedUpgradeVersions.find((item) => item.version === version)?.logic ?? "");
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a version" /></SelectTrigger>
                    <SelectContent>
                      {approvedUpgradeVersions.map((version) => (
                        <SelectItem key={version.version} value={version.version}>Version {version.version}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {upgradeLogic ? (
                    <div className="text-xs text-muted-foreground">
                      New version address: <CopyableAddress value={upgradeLogic} />
                    </div>
                  ) : null}
                  <details>
                    <summary className="cursor-pointer text-sm">Advanced</summary>
                    <div className="mt-2 space-y-2">
                      <Label>Migration function (must begin with migrate; empty for none)</Label>
                      <Input value={migrationFunction} onChange={(event) => setMigrationFunction(event.target.value)} />
                    </div>
                  </details>
                  <Button
                    disabled={busy || !state.provenanceVerified || !upgradeVersion}
                    onClick={() => void proposeUpgradeControl("schedule")}
                  >
                    Propose upgrade
                  </Button>
                </>
              ) : null}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Details</summary>
                <div className="mt-1">Version address: <CopyableAddress value={state.logic} /></div>
                <div>Configuration number: {state.epoch}</div>
              </details>
            </ActionCard>
          </SettingsGroup>

          {!state.upgradesFrozen ? (
            <details className="rounded-lg border border-destructive/40 p-4">
              <summary className="cursor-pointer font-medium text-destructive">Danger zone</summary>
              <div className="mt-3 space-y-3">
                <div className="text-sm text-muted-foreground">
                  Freezing upgrades is permanent. A frozen multisig wallet can never receive security fixes.
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !state.provenanceVerified}
                  onClick={() => void proposeUpgradeControl("freeze")}
                >
                  Propose permanent freeze
                </Button>
              </div>
            </details>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateDedicatedMultisig() {
  const { userAddress } = useUser();
  const actions = useDedicatedMultisigActions();
  const { data: factoryState } = useDedicatedFactoryState();
  const [label, setLabel] = useState("");
  const [signerInputs, setSignerInputs] = useState([
    { text: userAddress ?? "", address: strip0x(userAddress ?? "") },
  ]);
  const [required, setRequired] = useState(2);
  const [timelockHours, setTimelockHours] = useState(24);
  const [registeredHere, setRegisteredHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const invalidSigners = signerInputs.filter((signer) => signer.text.trim() && !signer.address);
  const normalizedSignerEntries = signerInputs.map((signer) => strip0x(signer.address)).filter(Boolean);
  const duplicateSigners = normalizedSignerEntries.length !== new Set(normalizedSignerEntries).size;
  const signers = [...new Set(normalizedSignerEntries.filter((value) => value.length === 40))].sort();
  const configured = factoryState?.verified === true;
  const latestVersion =
    factoryState?.approvedVersions[factoryState.approvedVersions.length - 1]?.version || "";
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
        initialVersion: latestVersion,
        label,
      });
      setRegisteredHere(true);
      toast.success("Invitation created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create multisig wallet");
    } finally {
      setBusy(false);
    }
  };

  if (registeredHere) {
    return (
      <div className="rounded-md border p-3 text-sm">
        <div className="font-medium">Invitation created</div>
        <div className="mt-1 text-muted-foreground">
          Review it under Pending invitations to confirm or share it with the other signers.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
      <Button
        disabled={busy || !configured || invalidSigners.length > 0 || duplicateSigners ||
          !validLabel || signers.length < 3 || !validRequired || !validTimelock || !latestVersion}
        onClick={() => void register()}
      >
        Create multisig wallet
      </Button>
    </div>
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
      <DialogContent
        className="h-[100dvh] max-h-[100dvh] w-screen max-w-none content-start overflow-y-auto rounded-none border-0 p-4 md:p-8"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{wallet ? "Multisig wallet" : "Create multisig wallet"}</DialogTitle>
          <DialogDescription>
            {wallet
              ? "Manage funds, propose and approve actions, and administer signers and rules."
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
