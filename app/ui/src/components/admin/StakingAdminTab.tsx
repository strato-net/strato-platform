import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/axios";
import { useToast } from "@/hooks/use-toast";
import { truncateAddress } from "@/utils/numberUtils";
import ValidatorStatusBadge from "@/components/staking/ValidatorStatusBadge";

// Minimal read model: the same payload as the Earn Staking page, public fields only.
type AdminOperator = {
  // Validator-keyed contract (v2): the validator address, which keys the record.
  // Operator-keyed contract (v1): the operator, same as `operator`.
  address: string;
  operator: string;
  name: string;
  validatorAddress: string;
  status: 0 | 1 | 2 | 3;
  isWaiter: boolean;
  jailedUntil: string;
  exitReadyTime: string;
  commissionBps: string;
  totalStake: string;
  blocksProposed: string;
  missedProposals: string;
};

type AdminInfo = {
  stakingAddress: string;
  validatorRegistryAddress: string;
  // False until the validator-set / proposer-fee upgrade is deployed on this network.
  // Everything below the eligibility/set/governance line is unreachable until then.
  validatorSetDeployed: boolean;
  // "v2" = validator-keyed contract; absent on backends that predate the field.
  contractVersion?: "v1" | "v2";
  // v2: unix seconds after which only self-bond counts toward minStake ("0" = not set).
  selfBondGraceUntil?: string;
  selfBondRuleActive?: boolean;
  minStake: string;
  minSelfBond: string;
  proposerFeeBps: string;
  maxConsecutiveMisses: string;
  jailCooldown: string;
  maxActiveValidators: string;
  hardCapActiveValidators: string;
  evictionMarginBps: string;
  maxSetMutationsPerBlock: string;
  exitNoticeSeconds: string;
  unkickCooldown: string;
  maxOperatorStakeBps: string;
  joinsPaused: boolean;
  governanceSyncEnabled: boolean;
  validatorCount: string;
  unattributedFees: string;
  validators: AdminOperator[];
};

const fromWad = (value: string): string => {
  try {
    const v = BigInt(value || "0");
    return (v / 10n ** 18n).toString();
  } catch {
    return "0";
  }
};
const toWad = (value: string): string => {
  const [whole, fraction = ""] = value.trim().split(".");
  return (BigInt(whole || "0") * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18))).toString();
};
const isAddressLike = (value: string): boolean => /^(0x)?[0-9a-fA-F]{40}$/.test(value.trim());

// <input type="datetime-local"> works in local wall-clock time; the contract takes unix seconds.
const toDateTimeLocal = (seconds: string | undefined): string => {
  const ts = Number(seconds || "0");
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const date = new Date(ts * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromDateTimeLocal = (value: string): string | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000).toString() : null;
};

type FieldSpec = { key: string; label: string; wad?: boolean };

// Every admin write is an AdminRegistry vote built by the backend (castVoteOnIssue);
// the call takes effect once enough admins have voted.
const StakingAdminTab = () => {
  const { toast } = useToast();
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [validatorParams, setValidatorParams] = useState<Record<string, string>>({});
  const [setParams, setSetParams] = useState<Record<string, string>>({});
  const [joinsPaused, setJoinsPaused] = useState(true);
  const [governanceSync, setGovernanceSync] = useState(false);
  const [newOperator, setNewOperator] = useState({ operator: "", validatorAddress: "", commissionPercent: "", name: "" });
  // v1: bind a validator address to an operator. v2: move a validator to a new operator.
  const [validatorAddressEdit, setValidatorAddressEdit] = useState({ operator: "", validatorAddress: "" });
  const [selfBondGrace, setSelfBondGrace] = useState("");
  const [hardCap, setHardCap] = useState("");
  const [emergencyKicker, setEmergencyKicker] = useState("");
  const [recovery, setRecovery] = useState({ to: "", amount: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<AdminInfo>("/staking/info");
      setInfo(data);
      setValidatorParams({
        minStake: fromWad(data.minStake),
        minSelfBond: fromWad(data.minSelfBond),
        proposerFeeBps: data.proposerFeeBps,
        maxConsecutiveMisses: data.maxConsecutiveMisses,
        jailCooldown: data.jailCooldown,
      });
      setSetParams({
        maxActiveValidators: data.maxActiveValidators,
        hardCapActiveValidators: data.hardCapActiveValidators,
        evictionMarginBps: data.evictionMarginBps,
        maxSetMutationsPerBlock: data.maxSetMutationsPerBlock,
        exitNoticeSeconds: data.exitNoticeSeconds,
        unkickCooldown: data.unkickCooldown,
        maxOperatorStakeBps: data.maxOperatorStakeBps,
      });
      setJoinsPaused(Boolean(data.joinsPaused));
      setGovernanceSync(Boolean(data.governanceSyncEnabled));
      setSelfBondGrace(toDateTimeLocal(data.selfBondGraceUntil));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, title: string) => {
    try {
      setBusy(key);
      await action();
      toast({ title, description: "Vote submitted; it applies once enough admins approve.", variant: "success" });
      await refresh();
    } catch (error: unknown) {
      const failure = error as { response?: { data?: { error?: string } }; message?: string } | null;
      toast({ title: "Request failed", description: failure?.response?.data?.error || failure?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const label = (key: string, text: string) => (busy === key ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />{text}</>) : text);

  const paramGrid = (spec: FieldSpec[], values: Record<string, string>, setValues: (next: Record<string, string>) => void, extra?: ReactNode) => (
    <div className="grid gap-3 md:grid-cols-3">
      {spec.map((field) => (
        <label key={field.key} className="space-y-1 text-xs">
          <span className="text-muted-foreground">{field.label}</span>
          <Input value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
        </label>
      ))}
      {extra}
    </div>
  );

  if (loading && !info) {
    return <p className="text-sm text-muted-foreground">Loading staking configuration...</p>;
  }
  if (!info) {
    return <p className="text-sm text-muted-foreground">Staking is not configured on this network.</p>;
  }

  // Every control below the reward/commission basics calls a method the upgrade added.
  // The reads already default to unset, so the writes are what has to stay locked.
  const upgradePending = info.validatorSetDeployed === false;
  const blocked = busy !== null || upgradePending;
  // Validator-keyed contract: rows, request bodies and operator controls key on the validator.
  const isV2 = info.contractVersion === "v2";
  const rowKey = (row: AdminOperator): string => (isV2 ? row.address : row.operator);
  const graceSeconds = fromDateTimeLocal(selfBondGrace);
  const graceInPast = graceSeconds !== null && Number(graceSeconds) <= Date.now() / 1000;
  const currentGrace = Number(info.selfBondGraceUntil || "0");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Staking {truncateAddress(info.stakingAddress, 8, 6)} · Registry {truncateAddress(info.validatorRegistryAddress, 8, 6)} · {info.validatorCount} validators in the set
        </p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      {upgradePending && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          The validator-set staking upgrade is not deployed on this network yet. Validator parameters, set
          admission, the governance link and validator-address binding read as unset and cannot be voted on
          until the new StratoStaking and ValidatorRegistry are live. Rewards, commission and operator
          listing continue to work against the deployed contracts.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Validator parameters</CardTitle>
          <CardDescription>Eligibility threshold, proposer fee share and the liveness jail knob (0 = never jail).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {paramGrid([
            isV2
              ? { key: "minStake", label: "Min stake (STRATO, self-bond requirement)", wad: true }
              : { key: "minStake", label: "Min stake (STRATO, self-bond + delegated)", wad: true },
            // The validator-keyed contract has no separate min self-bond; minStake is the self-bond bar.
            ...(isV2 ? [] : [{ key: "minSelfBond", label: "Min self-bond (STRATO)", wad: true }]),
            { key: "proposerFeeBps", label: "Proposer fee share (bps)" },
            { key: "maxConsecutiveMisses", label: "Jail after consecutive misses" },
            { key: "jailCooldown", label: "Jail cooldown (seconds)" },
          ], validatorParams, setValidatorParams)}
          <Button size="sm" disabled={blocked} onClick={() => run("validator-params", () => api.patch("/staking/admin/validator-params", {
            minStake: toWad(validatorParams.minStake || "0"),
            minSelfBond: toWad(validatorParams.minSelfBond || "0"),
            proposerFeeBps: validatorParams.proposerFeeBps,
            maxConsecutiveMisses: validatorParams.maxConsecutiveMisses,
            jailCooldown: validatorParams.jailCooldown,
          }), "Validator parameters vote")}>
            {label("validator-params", "Save validator parameters")}
          </Button>
        </CardContent>
      </Card>

      {isV2 && (
        <Card>
          <CardHeader>
            <CardTitle>Self-bond grace deadline</CardTitle>
            <CardDescription>Min stake is a self-bond requirement. Until this deadline delegated stake still counts toward it; after it only self-bond does.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Current deadline: {Number.isFinite(currentGrace) && currentGrace > 0 ? new Date(currentGrace * 1000).toLocaleString() : "not set"}
              {" · "}Self-bond rule {info.selfBondRuleActive ? "active" : "not active"}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">New deadline (your local time)</span>
                <Input type="datetime-local" value={selfBondGrace} onChange={(event) => setSelfBondGrace(event.target.value)} className="w-64" />
              </label>
              <Button size="sm" disabled={blocked || graceSeconds === null} onClick={() => run("self-bond-grace", () => api.patch("/staking/admin/self-bond-grace", {
                selfBondGraceUntil: graceSeconds,
              }), "Self-bond grace vote")}>
                {label("self-bond-grace", "Set deadline")}
              </Button>
            </div>
            <p className={`text-xs ${graceInPast ? "font-medium text-destructive" : "text-muted-foreground"}`}>
              {graceInPast
                ? "This deadline is already past: once the vote passes, the self-bond rule applies immediately and validators without enough self-bond are removed from the set."
                : "A deadline in the past applies the rule immediately and removes validators without enough self-bond from the set."}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Validator set</CardTitle>
          <CardDescription>Set size and admission rules. Joins stay paused until stake-weighted votes are live on every node.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {paramGrid([
            { key: "maxActiveValidators", label: "Max active validators" },
            { key: "hardCapActiveValidators", label: "Hard cap (only lowers)" },
            { key: "evictionMarginBps", label: "Eviction margin (bps)" },
            { key: "maxSetMutationsPerBlock", label: "Set mutations per block" },
            { key: "exitNoticeSeconds", label: "Exit notice (seconds)" },
            { key: "unkickCooldown", label: "Unkick cooldown (seconds)" },
            { key: "maxOperatorStakeBps", label: "Max operator stake (bps, 0 = off)" },
          ], setParams, setSetParams, (
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={!joinsPaused} onCheckedChange={(checked) => setJoinsPaused(!checked)} />
              <span>Permissionless joins {joinsPaused ? "paused" : "open"}</span>
            </label>
          ))}
          <Button size="sm" disabled={blocked} onClick={() => run("set-params", () => api.patch("/staking/admin/set-params", { ...setParams, joinsPaused }), "Validator set vote")}>
            {label("set-params", "Save set parameters")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Governance link</CardTitle>
          <CardDescription>Wire MercataGovernance (0x100) to the staking contract and bound the consensus set. Enable sync only once every current validator is listed and staked.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button size="sm" variant="outline" disabled={blocked} onClick={() => run("gov-staking", () => api.patch("/staking/admin/governance/staking-contract", {}), "Governance staking-contract vote")}>
            {label("gov-staking", "Point governance at staking")}
          </Button>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={governanceSync} onCheckedChange={setGovernanceSync} />
            <span>Staking → governance sync {governanceSync ? "enabled" : "disabled"}</span>
          </label>
          <Button size="sm" disabled={blocked} onClick={() => run("gov-sync", () => api.patch("/staking/admin/governance", { syncEnabled: governanceSync }), "Governance sync vote")}>
            {label("gov-sync", "Save sync")}
          </Button>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Governance hard cap</span>
            <Input value={hardCap} onChange={(event) => setHardCap(event.target.value)} placeholder="50" className="w-28" />
          </label>
          <Button size="sm" variant="outline" disabled={blocked || !/^\d+$/.test(hardCap)} onClick={() => run("gov-cap", () => api.patch("/staking/admin/governance/hard-cap", { hardCap }), "Governance hard-cap vote")}>
            {label("gov-cap", "Set hard cap")}
          </Button>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Emergency kicker (ops key)</span>
            <Input value={emergencyKicker} onChange={(event) => setEmergencyKicker(event.target.value)} placeholder="address" className="w-96" />
          </label>
          <Button size="sm" variant="outline" disabled={blocked || !isAddressLike(emergencyKicker)} onClick={() => run("kicker", () => api.patch("/staking/admin/emergency-kicker", { kicker: emergencyKicker.trim() }), "Emergency kicker vote")}>
            {label("kicker", "Set kicker")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operators</CardTitle>
          <CardDescription>
            {isV2
              ? "List a validator under an operator (it still has to self-bond and activate), move a validator to a new operator, kick."
              : "List an operator (it still has to bond and activate), bind validator addresses, kick."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            {isV2 ? (
              <>
                <Input value={newOperator.validatorAddress} onChange={(event) => setNewOperator({ ...newOperator, validatorAddress: event.target.value })} placeholder="Validator (node) address" />
                <Input value={newOperator.operator} onChange={(event) => setNewOperator({ ...newOperator, operator: event.target.value })} placeholder="Operator address" />
              </>
            ) : (
              <>
                <Input value={newOperator.operator} onChange={(event) => setNewOperator({ ...newOperator, operator: event.target.value })} placeholder="Operator address" />
                <Input value={newOperator.validatorAddress} onChange={(event) => setNewOperator({ ...newOperator, validatorAddress: event.target.value })} placeholder="Validator (node) address" />
              </>
            )}
            <Input value={newOperator.commissionPercent} onChange={(event) => setNewOperator({ ...newOperator, commissionPercent: event.target.value })} placeholder="Commission %" inputMode="decimal" />
            <Input value={newOperator.name} onChange={(event) => setNewOperator({ ...newOperator, name: event.target.value })} placeholder="Name" />
            <Button size="sm" disabled={busy !== null || !isAddressLike(newOperator.operator) || (!upgradePending && !isAddressLike(newOperator.validatorAddress)) || !/^\d+(\.\d{0,2})?$/.test(newOperator.commissionPercent)}
              onClick={() => run("add", () => api.post("/staking/admin/operators", isV2 ? {
                validator: newOperator.validatorAddress.trim(),
                operator: newOperator.operator.trim(),
                commissionBps: Math.round(parseFloat(newOperator.commissionPercent) * 100).toString(),
                name: newOperator.name,
              } : {
                operator: newOperator.operator.trim(),
                validatorAddress: newOperator.validatorAddress.trim(),
                commissionBps: Math.round(parseFloat(newOperator.commissionPercent) * 100).toString(),
                name: newOperator.name,
              }), isV2 ? "Add validator vote" : "Add operator vote")}>
              {label("add", isV2 ? "Add validator" : "Add operator")}
            </Button>
          </div>
          {isV2 ? (
            <div className="grid gap-3 md:grid-cols-5">
              <Input value={validatorAddressEdit.validatorAddress} onChange={(event) => setValidatorAddressEdit({ ...validatorAddressEdit, validatorAddress: event.target.value })} placeholder="Validator address" />
              <Input value={validatorAddressEdit.operator} onChange={(event) => setValidatorAddressEdit({ ...validatorAddressEdit, operator: event.target.value })} placeholder="New operator address" className="md:col-span-2" />
              <Button size="sm" variant="outline" disabled={blocked || !isAddressLike(validatorAddressEdit.validatorAddress) || !isAddressLike(validatorAddressEdit.operator)}
                onClick={() => run("set-operator", () => api.patch("/staking/admin/operators/operator", {
                  validator: validatorAddressEdit.validatorAddress.trim(),
                  operator: validatorAddressEdit.operator.trim(),
                }), "Set operator vote")}>
                {label("set-operator", "Set operator")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-5">
              <Input value={validatorAddressEdit.operator} onChange={(event) => setValidatorAddressEdit({ ...validatorAddressEdit, operator: event.target.value })} placeholder="Operator address" />
              <Input value={validatorAddressEdit.validatorAddress} onChange={(event) => setValidatorAddressEdit({ ...validatorAddressEdit, validatorAddress: event.target.value })} placeholder="New validator address (0x0 clears)" className="md:col-span-2" />
              <Button size="sm" variant="outline" disabled={blocked || !isAddressLike(validatorAddressEdit.operator) || !isAddressLike(validatorAddressEdit.validatorAddress)}
                onClick={() => run("validator-address", () => api.patch("/staking/admin/operators/validator-address", {
                  operator: validatorAddressEdit.operator.trim(),
                  validatorAddress: validatorAddressEdit.validatorAddress.trim(),
                }), "Validator address vote")}>
                {label("validator-address", "Bind validator address")}
              </Button>
            </div>
          )}

          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{isV2 ? "Validator" : "Operator"}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{isV2 ? "Operator" : "Validator"}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Stake</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Blocks / missed</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {info.validators.map((row) => {
                  const key = rowKey(row);
                  // v1 rows are operators with an optional bound validator; v2 rows are validators with an operator.
                  const secondary = isV2 ? row.operator : row.validatorAddress;
                  const target = isV2 ? { validator: key } : { operator: key };
                  return (
                    <tr key={key} className="border-t border-border/50">
                      <td className="px-3 py-2">
                        <p className="font-medium">{row.name || truncateAddress(key, 8, 6)}</p>
                        <p className="text-xs text-muted-foreground">{key}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">{secondary ? truncateAddress(secondary, 8, 6) : "—"}</td>
                      <td className="px-3 py-2"><ValidatorStatusBadge validator={row} /></td>
                      <td className="px-3 py-2 text-right">{fromWad(row.totalStake)}</td>
                      <td className="px-3 py-2 text-right">{row.blocksProposed} / {row.missedProposals}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          {row.isWaiter && (
                            <Button size="sm" variant="outline" disabled={blocked} onClick={() => run(`activate-${key}`, () => api.post("/staking/activate", target), "Activation submitted")}>
                              {label(`activate-${key}`, "Activate")}
                            </Button>
                          )}
                          {row.status !== 3 && (
                            <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run(`kick-${key}`, () => api.delete("/staking/admin/operators", { data: target }), "Kick vote")}>
                              {label(`kick-${key}`, "Kick")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" variant="outline" disabled={blocked} onClick={() => run("reconcile", () => api.post("/staking/reconcile", {}), "Reconcile submitted")}>
              {label("reconcile", "Promote waiters (reconcile)")}
            </Button>
            <span className="text-xs text-muted-foreground">Unattributed fees: {fromWad(info.unattributedFees)} USDST</span>
            <Input value={recovery.to} onChange={(event) => setRecovery({ ...recovery, to: event.target.value })} placeholder="Recover to" className="w-80" />
            <Input value={recovery.amount} onChange={(event) => setRecovery({ ...recovery, amount: event.target.value })} placeholder="USDST" className="w-32" inputMode="decimal" />
            <Button size="sm" variant="outline" disabled={blocked || !isAddressLike(recovery.to) || !/^\d+(\.\d+)?$/.test(recovery.amount)}
              onClick={() => run("recover", () => api.post("/staking/admin/recover-fees", { to: recovery.to.trim(), amount: toWad(recovery.amount) }), "Fee recovery vote")}>
              {label("recover", "Recover fees")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StakingAdminTab;
