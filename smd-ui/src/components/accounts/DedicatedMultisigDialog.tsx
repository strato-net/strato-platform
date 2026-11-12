import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, ShieldCheck } from "lucide-react";
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
  useDedicatedSetup,
  useDedicatedSetupLifecycle,
  useDedicatedWalletState,
  extractDedicatedSetupResult,
  isUnlimitedTokenApproval,
  parseDedicatedTypedArguments,
  type DedicatedIssue,
  useDedicatedFactoryState,
} from "@/services/dedicatedMultisig";
import { strip0x, type UserWallet } from "@/services/userWallets";

function IssueActions({ wallet, issue, disabled }: { wallet: UserWallet; issue: DedicatedIssue; disabled: boolean }) {
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
        throw new Error("Argument types do not match the committed issue");
      }
      if (execute) await actions.executeIssue(issue, args, signerUsername);
      else await actions.approveIssue(issue, args, signerUsername);
      toast.success(execute ? "Issue executed" : "Issue approved");
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
      toast.success(dismiss ? "Issue dismissed" : "Approval revoked");
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

  const cancelQueuedIssue = async () => {
    setBusy(true);
    try {
      await actions.proposeIssue(wallet.address, "cancelIssue", ["string"], [
        typedVariadicArg("string", issue.issueId),
      ], signerUsername);
      toast.success("Cancellation issue created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create cancellation issue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Nonce {issue.nonce}</Badge>
        <Badge variant="outline">Epoch {issue.epoch}</Badge>
        <Badge variant="secondary">{issue.approvals} approvals</Badge>
      </div>
      <div><span className="text-muted-foreground">Target:</span> <span className="font-mono break-all">{issue.target}</span></div>
      <div><span className="text-muted-foreground">Function:</span> <span className="font-mono">{issue.functionName}</span></div>
      <div><span className="text-muted-foreground">Types:</span> <span className="font-mono break-all">{JSON.stringify(issue.argumentTypes)}</span></div>
      <div><span className="text-muted-foreground">Arguments:</span> <span className="font-mono break-all">{JSON.stringify(issue.arguments)}</span></div>
      <div className="text-xs text-muted-foreground">
        Issue {issue.issueId} · expires {new Date(issue.expiresAt * 1000).toLocaleString()}
      </div>
      {unlimitedApproval ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unlimited token approval</AlertTitle>
          <AlertDescription>Review the spender and amount carefully before approving.</AlertDescription>
        </Alert>
      ) : null}
      <Label>Exact typed arguments</Label>
      <Textarea value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} className="font-mono text-xs" />
      <div className="flex gap-2">
        {issue.executableAt === 0 && !approved ? (
          <Button size="sm" disabled={busy || disabled} onClick={() => void run(false)}>Approve</Button>
        ) : null}
        {issue.executableAt > 0 ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || disabled || Date.now() / 1000 < issue.executableAt}
              onClick={() => void run(true)}
            >
              Execute
            </Button>
            <Button size="sm" variant="destructive" disabled={busy || disabled} onClick={() => void cancelQueuedIssue()}>
              Create cancellation issue
            </Button>
          </>
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

function ManageDedicatedMultisig({ wallet }: { wallet: UserWallet }) {
  const { data: state, isLoading } = useDedicatedWalletState(wallet.address);
  const { data: issues = [] } = useDedicatedIssues(wallet.address, state?.epoch);
  const actions = useDedicatedMultisigActions(wallet.address);
  const signerUsername = wallet.signerUsername || undefined;
  const [target, setTarget] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [argumentsJson, setArgumentsJson] = useState("[]");
  const [upgradeLogic, setUpgradeLogic] = useState("");
  const [upgradeVersion, setUpgradeVersion] = useState("");
  const [migrationFunction, setMigrationFunction] = useState("");
  const [nominee, setNominee] = useState("");
  const [replaceSigner, setReplaceSigner] = useState("");
  const [removeSigner, setRemoveSigner] = useState("");
  const [newRequiredApprovals, setNewRequiredApprovals] = useState("");
  const [newTimelock, setNewTimelock] = useState("");
  const [busy, setBusy] = useState(false);

  const acceptNomination = async () => {
    setBusy(true);
    try {
      await actions.acceptNomination(wallet.nomineeUsername || undefined);
      toast.success("Signer nomination accepted");
    } catch (error: any) {
      toast.error(error?.message || "Could not accept nomination");
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    setBusy(true);
    try {
      const { types, args } = parseDedicatedTypedArguments(argumentsJson);
      await actions.proposeIssue(target, functionName, types, args, signerUsername);
      toast.success("Issue proposed");
    } catch (error: any) {
      toast.error(error?.message || "Could not propose issue");
    } finally {
      setBusy(false);
    }
  };

  const executeUpgrade = async () => {
    setBusy(true);
    try {
      await actions.executeUpgrade();
      toast.success("Upgrade executed");
    } catch (error: any) {
      toast.error(error?.message || "Could not execute upgrade");
    } finally {
      setBusy(false);
    }
  };

  const proposeUpgradeControl = async (operation: "schedule" | "cancel" | "freeze") => {
    setBusy(true);
    try {
      if (operation === "schedule") {
        if (!/^(0x)?[0-9a-f]{40}$/i.test(upgradeLogic)) throw new Error("Enter a valid target logic address");
        if (!upgradeVersion.trim()) throw new Error("Enter the target version");
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
      toast.success(`${operation === "schedule" ? "Upgrade" : operation === "cancel" ? "Cancellation" : "Freeze"} issue created`);
    } catch (error: any) {
      toast.error(error?.message || "Could not create upgrade issue");
    } finally {
      setBusy(false);
    }
  };

  const proposeConfiguration = async (mode: "nominate" | "remove" | "threshold" | "timelock") => {
    if (!state) return;
    setBusy(true);
    try {
      if (mode === "timelock") {
        if (!/^\d+$/.test(newTimelock) || BigInt(newTimelock) > 2592000n) {
          throw new Error("Timelock must be a whole number from 0 to 2592000 seconds");
        }
        await actions.proposeIssue(wallet.address, "setTransactionTimelock", ["uint256"], [
          typedVariadicArg("uint256", newTimelock),
        ], signerUsername);
      } else {
        let signers = [...state.signers];
        const required = mode === "threshold" ? Number(newRequiredApprovals) : state.requiredApprovals;
        let functionName = "applyConfiguration";
        let types = ["address[]", "uint256"];
        let args: unknown[];
        if (mode === "nominate") {
          const normalizedNominee = strip0x(nominee);
          if (!/^[0-9a-f]{40}$/i.test(normalizedNominee)) throw new Error("Enter a valid nominee address");
          if (signers.some((signer) => strip0x(signer) === normalizedNominee)) throw new Error("Nominee is already a signer");
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
            throw new Error("Required approvals must satisfy 2 <= M < N");
          }
          args = [
            typedVariadicArg("address[]", JSON.stringify(signers.sort())),
            typedVariadicArg("uint256", String(required)),
          ];
        }
        await actions.proposeIssue(wallet.address, functionName, types, args, signerUsername);
      }
      toast.success("Configuration issue created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create configuration issue");
    } finally {
      setBusy(false);
    }
  };

  const proposeNominationRevocation = async () => {
    const normalizedNominee = strip0x(nominee);
    if (!/^[0-9a-f]{40}$/i.test(normalizedNominee)) {
      toast.error("Enter the nominee address to revoke");
      return;
    }
    setBusy(true);
    try {
      await actions.proposeIssue(wallet.address, "revokeNomination", ["address"], [
        typedVariadicArg("address", normalizedNominee),
      ], signerUsername);
      toast.success("Nomination-revocation issue created");
    } catch (error: any) {
      toast.error(error?.message || "Could not create nomination-revocation issue");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !state) return <div className="text-sm text-muted-foreground">Loading wallet…</div>;
  return (
    <div className="space-y-4">
      {state.verified ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Factory-created and active</AlertTitle>
          <AlertDescription>Version {state.version} · {state.requiredApprovals} of {state.signers.length} approvals</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Wallet provenance could not be verified</AlertTitle>
          <AlertDescription>{state.verificationErrors.join(". ")}</AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue={wallet.pendingSigner ? "settings" : "treasury"}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="treasury">Treasury</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="treasury" className="mt-4">
          <DedicatedTreasuryTab wallet={wallet} disabled={!state.verified} />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <DedicatedProtocolActionsTab wallet={wallet} disabled={!state.verified} />
        </TabsContent>
        <TabsContent value="issues" className="mt-4 space-y-4">
          <div className="space-y-2">
            <div className="font-medium">Create custom issue</div>
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
              Create issue
            </Button>
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="font-medium">Open issues</div>
            {issues
              .filter((issue) => issue.epoch === state.epoch && issue.expiresAt >= Date.now() / 1000)
              .map((issue) => (
                <IssueActions
                  key={`${issue.issueId}:${JSON.stringify(issue.arguments)}`}
                  wallet={wallet}
                  issue={issue}
                  disabled={!state.verified}
                />
              ))}
            {!issues.some((issue) => issue.epoch === state.epoch && issue.expiresAt >= Date.now() / 1000) ? (
              <div className="text-sm text-muted-foreground">No open issues.</div>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <DedicatedHistoryTab wallet={wallet} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-4">
          <div className="grid gap-1 text-sm">
            <div>Logic: <span className="font-mono break-all">{state.logic}</span></div>
            <div>Epoch: {state.epoch}</div>
            <div>Transaction timelock: {state.transactionTimelock}s</div>
            <div>Upgrades: {state.upgradesFrozen ? "permanently frozen" : "enabled"}</div>
            <div>Signers: {state.signers.map((signer) => shortenHex(signer, 6, 4)).join(", ")}</div>
          </div>
          {wallet.pendingSigner ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Nominee: <span className="font-mono">{wallet.nomineeAddress}</span>
                {wallet.nomineeUsername ? ` (${wallet.nomineeUsername})` : ""}
              </div>
              <Button disabled={busy || !state.verified} onClick={() => void acceptNomination()}>
                Accept signer nomination
              </Button>
            </div>
          ) : null}
          <Separator />
          <div className="space-y-2">
            <div className="font-medium">Nominate signer</div>
            <Label>Nominee address</Label>
            <Input value={nominee} onChange={(event) => setNominee(event.target.value)} className="font-mono text-xs" />
            <Label>Signer to replace (leave empty to add)</Label>
            <Input value={replaceSigner} onChange={(event) => setReplaceSigner(event.target.value)} className="font-mono text-xs" />
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("nominate")}>
              Create nomination issue
            </Button>
            <Button variant="outline" disabled={busy || !state.verified} onClick={() => void proposeNominationRevocation()}>
              Revoke existing nomination
            </Button>
          </div>
          <div className="space-y-2">
            <div className="font-medium">Remove signer</div>
            <Input value={removeSigner} onChange={(event) => setRemoveSigner(event.target.value)} className="font-mono text-xs" />
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("remove")}>
              Create removal issue
            </Button>
          </div>
          <div className="space-y-2">
            <div className="font-medium">Change required approvals</div>
            <Input
              value={newRequiredApprovals}
              onChange={(event) => setNewRequiredApprovals(event.target.value)}
              inputMode="numeric"
              placeholder={`Current: ${state.requiredApprovals}`}
            />
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("threshold")}>
              Create threshold issue
            </Button>
          </div>
          <div className="space-y-2">
            <div className="font-medium">Change transaction timelock</div>
            <Input
              value={newTimelock}
              onChange={(event) => setNewTimelock(event.target.value)}
              inputMode="numeric"
              placeholder="Seconds"
            />
            <Button disabled={busy || !state.verified} onClick={() => void proposeConfiguration("timelock")}>
              Create timelock issue
            </Button>
          </div>
          {!state.upgradesFrozen && !state.pendingUpgrade ? (
            <div className="space-y-2">
              <div className="font-medium">Schedule approved upgrade</div>
              <Label>Target logic</Label>
              <Input value={upgradeLogic} onChange={(event) => setUpgradeLogic(event.target.value)} className="font-mono text-xs" />
              <Label>Target version</Label>
              <Input value={upgradeVersion} onChange={(event) => setUpgradeVersion(event.target.value)} />
              <Label>Migration function (must begin with migrate; empty for none)</Label>
              <Input value={migrationFunction} onChange={(event) => setMigrationFunction(event.target.value)} />
              <Button disabled={busy || !state.verified} onClick={() => void proposeUpgradeControl("schedule")}>
                Create upgrade issue
              </Button>
            </div>
          ) : null}
          {state.pendingUpgrade ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Pending upgrade to version {state.pendingUpgrade.targetVersion}</AlertTitle>
              <AlertDescription className="space-y-2">
                <div className="font-mono break-all">Logic: {state.pendingUpgrade.targetLogic}</div>
                <div>
                  Executable {new Date(state.pendingUpgrade.executableAt * 1000).toLocaleString()} ·
                  expires {new Date(state.pendingUpgrade.expiresAt * 1000).toLocaleString()}
                </div>
                <div>Migration: {state.pendingUpgrade.migrationFunction || "No migration"}</div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !state.verified || Date.now() / 1000 < state.pendingUpgrade.executableAt}
                  onClick={() => void executeUpgrade()}
                >
                  Execute committed upgrade
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !state.verified}
                  onClick={() => void proposeUpgradeControl("cancel")}
                >
                  Create cancellation issue
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {!state.upgradesFrozen ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Permanent upgrade freeze</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>A frozen wallet can never receive security fixes.</p>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy || !state.verified}
                  onClick={() => void proposeUpgradeControl("freeze")}
                >
                  Create permanent-freeze issue
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
  const actions = useDedicatedMultisigActions();
  const { data: factoryState } = useDedicatedFactoryState();
  const [label, setLabel] = useState("");
  const [signerText, setSignerText] = useState("");
  const [required, setRequired] = useState(2);
  const [timelockHours, setTimelockHours] = useState(24);
  const [salt, setSalt] = useState("");
  const [initialVersion, setInitialVersion] = useState("");
  const [setupHash, setSetupHash] = useState("");
  const [signerUsername, setSignerUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const signerEntries = useMemo(
    () => signerText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
    [signerText]
  );
  const invalidSigners = signerEntries.filter((value) => !/^(0x)?[0-9a-f]{40}$/i.test(value));
  const normalizedSignerEntries = signerEntries.map(strip0x);
  const duplicateSigners = normalizedSignerEntries.length !== new Set(normalizedSignerEntries).size;
  const signers = [...new Set(normalizedSignerEntries.filter((value) => value.length === 40))].sort();
  const configured = factoryState?.verified === true;
  const selectedInitialVersion = initialVersion || factoryState?.approvedVersions[0]?.version || "";
  const { data: setup } = useDedicatedSetup(setupHash);
  const { data: setupLifecycle = "unknown" } = useDedicatedSetupLifecycle(setupHash);
  const setupPending = setupLifecycle === "pending" && !!setup && setup.expiresAt >= Date.now() / 1000;
  const displayedSetupLifecycle = setupLifecycle === "pending" && setup && !setupPending
    ? "expired"
    : setupLifecycle;
  const validRequired = Number.isInteger(required) && required >= 2 && required < signers.length;
  const validTimelock = Number.isInteger(timelockHours) && timelockHours >= 0 && timelockHours <= 720;

  const register = async () => {
    setBusy(true);
    try {
      if (!validRequired) throw new Error("Required approvals must be an integer satisfying 2 <= M < N");
      if (!validTimelock) throw new Error("Timelock must be a whole number from 0 to 720 hours");
      const result = await actions.registerSetup({
        signers,
        requiredApprovals: required,
        transactionTimelock: Math.round(timelockHours * 3600),
        initialVersion: selectedInitialVersion,
        salt: salt || label,
      });
      const registered = extractDedicatedSetupResult(result);
      if (!registered) throw new Error("Setup registered but its hash could not be read from the transaction result");
      setSetupHash(registered.setupHash);
      toast.success("Setup registered. Every signer must now confirm its setup hash.");
    } catch (error: any) {
      toast.error(error?.message || "Could not register setup");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await actions.confirmSetup(setupHash, signerUsername || undefined);
      toast.success("Signer confirmation submitted");
    } catch (error: any) {
      toast.error(error?.message || "Could not confirm setup");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await actions.cancelSetup(setupHash, signerUsername || undefined);
      toast.success("Pending setup cancelled");
    } catch (error: any) {
      toast.error(error?.message || "Could not cancel setup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tabs defaultValue="create">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="create">Create</TabsTrigger>
        <TabsTrigger value="confirm">Confirm</TabsTrigger>
      </TabsList>
      <TabsContent value="create" className="space-y-3">
        {!configured ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Factory not configured</AlertTitle>
            <AlertDescription>
              {factoryState?.verificationErrors.join(". ") || "Factory verification is loading."}
            </AlertDescription>
          </Alert>
        ) : null}
        <Label>Wallet label</Label>
        <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        <Label>Signer addresses</Label>
        <Textarea value={signerText} onChange={(event) => setSignerText(event.target.value)} placeholder="One address per line" />
        {invalidSigners.length ? (
          <p className="text-xs text-destructive">Invalid signer: {invalidSigners[0]}</p>
        ) : duplicateSigners ? (
          <p className="text-xs text-destructive">Signer addresses must be unique.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Required approvals</Label><Input type="number" min={2} step={1} value={required} onChange={(event) => setRequired(Number(event.target.value))} /></div>
          <div><Label>Transaction timelock (hours)</Label><Input type="number" min={0} max={720} step={1} value={timelockHours} onChange={(event) => setTimelockHours(Number(event.target.value))} /></div>
        </div>
        <Label>Initial logic version</Label>
        <Select value={selectedInitialVersion} onValueChange={setInitialVersion}>
          <SelectTrigger><SelectValue placeholder="Select an approved version" /></SelectTrigger>
          <SelectContent>
            {(factoryState?.approvedVersions ?? []).map((version) => (
              <SelectItem key={version.version} value={version.version}>
                {version.version} · {shortenHex(version.logic, 6, 4)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label>Deterministic salt (optional)</Label>
        <Input value={salt} onChange={(event) => setSalt(event.target.value)} />
        <div className="rounded-md bg-muted p-3 text-sm">
          {label || "Dedicated multisig"} · {required} of {signers.length} approvals · {timelockHours}h timelock · logic v{selectedInitialVersion || "—"}
        </div>
        <Button
          disabled={busy || !configured || invalidSigners.length > 0 || duplicateSigners ||
            signers.length < 3 || !validRequired || !validTimelock || !selectedInitialVersion}
          onClick={() => void register()}
        >
          Register setup
        </Button>
      </TabsContent>
      <TabsContent value="confirm" className="space-y-3">
        <p className="text-sm text-muted-foreground">Confirm the exact setup hash after reviewing its signer set, threshold, timelock, and version.</p>
        <Label>Setup hash</Label>
        <Input value={setupHash} onChange={(event) => setSetupHash(event.target.value)} className="font-mono" />
        {setupHash ? <Badge variant="outline">Status: {displayedSetupLifecycle}</Badge> : null}
        {setup ? (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div>{setup.requiredApprovals} of {setup.signers.length} approvals · logic v{setup.initialVersion}</div>
            <div>Signer confirmation: {setup.confirmedSigners.length} of {setup.signers.length}</div>
            <div className="font-mono text-xs break-all">Creator: {setup.creator}</div>
            <div className="font-mono text-xs break-all">Expected wallet: {setup.expectedWallet}</div>
            {setupLifecycle !== "deployed" ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Do not fund this address yet</AlertTitle>
                <AlertDescription>
                  The expected wallet does not exist until every signer confirms. Funds sent before deployment may be permanently stranded if the setup is cancelled or expires.
                </AlertDescription>
              </Alert>
            ) : null}
            <div>Transaction timelock: {setup.transactionTimelock}s</div>
            <div>Setup expires: {new Date(setup.expiresAt * 1000).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">
              {setup.signers.map((signer) => `${setup.confirmedSigners.includes(signer) ? "✓" : "○"} ${signer}`).join("\n")}
            </div>
          </div>
        ) : null}
        <Label>Signer User-wallet username (only when the signer is a User wallet)</Label>
        <Input value={signerUsername} onChange={(event) => setSignerUsername(event.target.value)} />
        <div className="flex gap-2">
          <Button disabled={busy || !configured || !setupPending} onClick={() => void confirm()}>Confirm setup</Button>
          <Button variant="outline" disabled={busy || !configured || !setupPending} onClick={() => void cancel()}>
            Cancel setup
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export function DedicatedMultisigDialog({ wallet }: { wallet?: UserWallet }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={wallet ? "sm" : "default"} variant={wallet ? "outline" : "default"}>
          {wallet ? <ShieldCheck className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {wallet ? "Manage" : "Create multisig"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{wallet ? "Dedicated multisig" : "Create dedicated multisig"}</DialogTitle>
          <DialogDescription>
            {wallet ? "Review provenance, governance state, and complete issue payloads." : "Fresh factory wallet with no creator authority."}
          </DialogDescription>
        </DialogHeader>
        {wallet ? <ManageDedicatedMultisig wallet={wallet} /> : <CreateDedicatedMultisig />}
      </DialogContent>
    </Dialog>
  );
}
