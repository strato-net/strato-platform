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
  const [validatorAddressEdit, setValidatorAddressEdit] = useState({ operator: "", validatorAddress: "" });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Staking {truncateAddress(info.stakingAddress, 8, 6)} · Registry {truncateAddress(info.validatorRegistryAddress, 8, 6)} · {info.validatorCount} validators in the set
        </p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Validator parameters</CardTitle>
          <CardDescription>Eligibility threshold, proposer fee share and the liveness jail knob (0 = never jail).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {paramGrid([
            { key: "minStake", label: "Min stake (STRATO, self-bond + delegated)", wad: true },
            { key: "minSelfBond", label: "Min self-bond (STRATO)", wad: true },
            { key: "proposerFeeBps", label: "Proposer fee share (bps)" },
            { key: "maxConsecutiveMisses", label: "Jail after consecutive misses" },
            { key: "jailCooldown", label: "Jail cooldown (seconds)" },
          ], validatorParams, setValidatorParams)}
          <Button size="sm" disabled={busy !== null} onClick={() => run("validator-params", () => api.patch("/staking/admin/validator-params", {
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
          <Button size="sm" disabled={busy !== null} onClick={() => run("set-params", () => api.patch("/staking/admin/set-params", { ...setParams, joinsPaused }), "Validator set vote")}>
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
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("gov-staking", () => api.patch("/staking/admin/governance/staking-contract", {}), "Governance staking-contract vote")}>
            {label("gov-staking", "Point governance at staking")}
          </Button>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={governanceSync} onCheckedChange={setGovernanceSync} />
            <span>Staking → governance sync {governanceSync ? "enabled" : "disabled"}</span>
          </label>
          <Button size="sm" disabled={busy !== null} onClick={() => run("gov-sync", () => api.patch("/staking/admin/governance", { syncEnabled: governanceSync }), "Governance sync vote")}>
            {label("gov-sync", "Save sync")}
          </Button>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Governance hard cap</span>
            <Input value={hardCap} onChange={(event) => setHardCap(event.target.value)} placeholder="50" className="w-28" />
          </label>
          <Button size="sm" variant="outline" disabled={busy !== null || !/^\d+$/.test(hardCap)} onClick={() => run("gov-cap", () => api.patch("/staking/admin/governance/hard-cap", { hardCap }), "Governance hard-cap vote")}>
            {label("gov-cap", "Set hard cap")}
          </Button>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Emergency kicker (ops key)</span>
            <Input value={emergencyKicker} onChange={(event) => setEmergencyKicker(event.target.value)} placeholder="address" className="w-96" />
          </label>
          <Button size="sm" variant="outline" disabled={busy !== null || !isAddressLike(emergencyKicker)} onClick={() => run("kicker", () => api.patch("/staking/admin/emergency-kicker", { kicker: emergencyKicker.trim() }), "Emergency kicker vote")}>
            {label("kicker", "Set kicker")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operators</CardTitle>
          <CardDescription>List an operator (it still has to bond and activate), bind validator addresses, kick.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <Input value={newOperator.operator} onChange={(event) => setNewOperator({ ...newOperator, operator: event.target.value })} placeholder="Operator address" />
            <Input value={newOperator.validatorAddress} onChange={(event) => setNewOperator({ ...newOperator, validatorAddress: event.target.value })} placeholder="Validator (node) address" />
            <Input value={newOperator.commissionPercent} onChange={(event) => setNewOperator({ ...newOperator, commissionPercent: event.target.value })} placeholder="Commission %" inputMode="decimal" />
            <Input value={newOperator.name} onChange={(event) => setNewOperator({ ...newOperator, name: event.target.value })} placeholder="Name" />
            <Button size="sm" disabled={busy !== null || !isAddressLike(newOperator.operator) || !isAddressLike(newOperator.validatorAddress) || !/^\d+(\.\d{0,2})?$/.test(newOperator.commissionPercent)}
              onClick={() => run("add", () => api.post("/staking/admin/operators", {
                operator: newOperator.operator.trim(),
                validatorAddress: newOperator.validatorAddress.trim(),
                commissionBps: Math.round(parseFloat(newOperator.commissionPercent) * 100).toString(),
                name: newOperator.name,
              }), "Add operator vote")}>
              {label("add", "Add operator")}
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <Input value={validatorAddressEdit.operator} onChange={(event) => setValidatorAddressEdit({ ...validatorAddressEdit, operator: event.target.value })} placeholder="Operator address" />
            <Input value={validatorAddressEdit.validatorAddress} onChange={(event) => setValidatorAddressEdit({ ...validatorAddressEdit, validatorAddress: event.target.value })} placeholder="New validator address (0x0 clears)" className="md:col-span-2" />
            <Button size="sm" variant="outline" disabled={busy !== null || !isAddressLike(validatorAddressEdit.operator) || !isAddressLike(validatorAddressEdit.validatorAddress)}
              onClick={() => run("validator-address", () => api.patch("/staking/admin/operators/validator-address", {
                operator: validatorAddressEdit.operator.trim(),
                validatorAddress: validatorAddressEdit.validatorAddress.trim(),
              }), "Validator address vote")}>
              {label("validator-address", "Bind validator address")}
            </Button>
          </div>

          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Operator</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Validator</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Stake</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Blocks / missed</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {info.validators.map((operator) => (
                  <tr key={operator.operator} className="border-t border-border/50">
                    <td className="px-3 py-2">
                      <p className="font-medium">{operator.name || truncateAddress(operator.operator, 8, 6)}</p>
                      <p className="text-xs text-muted-foreground">{operator.operator}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">{operator.validatorAddress ? truncateAddress(operator.validatorAddress, 8, 6) : "—"}</td>
                    <td className="px-3 py-2"><ValidatorStatusBadge validator={operator} /></td>
                    <td className="px-3 py-2 text-right">{fromWad(operator.totalStake)}</td>
                    <td className="px-3 py-2 text-right">{operator.blocksProposed} / {operator.missedProposals}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {operator.isWaiter && (
                          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(`activate-${operator.operator}`, () => api.post("/staking/activate", { operator: operator.operator }), "Activation submitted")}>
                            {label(`activate-${operator.operator}`, "Activate")}
                          </Button>
                        )}
                        {operator.status !== 3 && (
                          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run(`kick-${operator.operator}`, () => api.delete("/staking/admin/operators", { data: { operator: operator.operator } }), "Kick vote")}>
                            {label(`kick-${operator.operator}`, "Kick")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("reconcile", () => api.post("/staking/reconcile", {}), "Reconcile submitted")}>
              {label("reconcile", "Promote waiters (reconcile)")}
            </Button>
            <span className="text-xs text-muted-foreground">Unattributed fees: {fromWad(info.unattributedFees)} USDST</span>
            <Input value={recovery.to} onChange={(event) => setRecovery({ ...recovery, to: event.target.value })} placeholder="Recover to" className="w-80" />
            <Input value={recovery.amount} onChange={(event) => setRecovery({ ...recovery, amount: event.target.value })} placeholder="USDST" className="w-32" inputMode="decimal" />
            <Button size="sm" variant="outline" disabled={busy !== null || !isAddressLike(recovery.to) || !/^\d+(\.\d+)?$/.test(recovery.amount)}
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
