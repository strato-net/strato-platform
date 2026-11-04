import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  isReady?: boolean;
  readyForAdmission?: boolean;
  jailedUntil: string;
  pendingOperator?: string;
  commissionBps: string;
  totalStake: string;
  blocksProposed: string;
  missedProposals: string;
  consecutiveMisses: string;
};

type AdminInfo = {
  stakingAddress: string;
  validatorRegistryAddress: string;
  // False until the validator-set staking upgrade is deployed on this network.
  // Everything below the set/governance line is unreachable until then.
  validatorSetDeployed: boolean;
  // "v2" = validator-keyed contract; absent on backends that predate the field.
  contractVersion?: "v1" | "v2";
  minStake: string;
  maxActiveValidators: string;
  hardCapActiveValidators: string;
  joinsOpenFromBlock?: string;
  joinsOpen?: boolean;
  governanceSyncEnabled: boolean;
  validatorCount: string;
  // v2 commitment constants and the set's readiness (see StratoStakingInfo).
  noticeSeconds?: string;
  readinessWindowSeconds?: string;
  readyWeightBps?: string;
  maxCreditedGapSeconds?: string;
  livenessMissLimit?: string;
  consensusWeight?: string;
  readyWeight?: string;
  // v2 emission schedule, committed once.
  rewardReserve?: string;
  eligibleStake?: string;
  emissionRateE0?: string;
  emissionStakeS0?: string;
  emissionReserveR0?: string;
  emissionStart?: string;
  emissionAnnualRate?: string;
  totalEmitted?: string;
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
const fromDateTimeLocal = (value: string): string | null => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000).toString() : null;
};
const days = (seconds: string | undefined): string => `${Math.round(Number(seconds || "0") / 86400)} day${Number(seconds || "0") === 86400 ? "" : "s"}`;

type FieldSpec = { key: string; label: string; wad?: boolean };

// Every admin write is an AdminRegistry vote built by the backend (castVoteOnIssue);
// the call takes effect once enough admins have voted. The commitment itself (the
// self-bond minimum, the week's notices, the readiness rules, the emission formula) is
// not votable: it reads here and changes only by a logic upgrade.
const StakingAdminTab = () => {
  const { toast } = useToast();
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [setParams, setSetParams] = useState<Record<string, string>>({});
  const [joinsOpenFromBlock, setJoinsOpenFromBlock] = useState("0");
  const [emission, setEmission] = useState<Record<string, string>>({});
  const [newOperator, setNewOperator] = useState({ operator: "", validatorAddress: "", commissionPercent: "", name: "" });
  // v1: bind a validator address to an operator (v2 validators are keyed by their address).
  const [validatorAddressEdit, setValidatorAddressEdit] = useState({ operator: "", validatorAddress: "" });
  const [hardCap, setHardCap] = useState("");
  // v2 removals carry published grounds.
  const [grounds, setGrounds] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<AdminInfo>("/staking/info");
      setInfo(data);
      setSetParams({
        maxActiveValidators: data.maxActiveValidators,
        hardCapActiveValidators: data.hardCapActiveValidators,
      });
      setJoinsOpenFromBlock(data.joinsOpenFromBlock || "0");
      setEmission({
        e0: fromWad(data.emissionRateE0 || "0"),
        s0: fromWad(data.emissionStakeS0 || "0"),
        r0: fromWad(data.emissionReserveR0 || "0"),
        start: "",
      });
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

  // Every control below the commission basics calls a method the upgrade added.
  // The reads already default to unset, so the writes are what has to stay locked.
  const upgradePending = info.validatorSetDeployed === false;
  const blocked = busy !== null || upgradePending;
  // Validator-keyed contract: rows, request bodies and operator controls key on the validator.
  const isV2 = info.contractVersion === "v2";
  const rowKey = (row: AdminOperator): string => (isV2 ? row.address : row.operator);
  const committed = Number(info.emissionStart || "0") > 0;
  const readyBps = Number(info.consensusWeight || "0") > 0
    ? Math.floor((Number(fromWad(info.readyWeight || "0")) * 10000) / Number(fromWad(info.consensusWeight || "0")))
    : 0;
  const missLimit = Number(info.livenessMissLimit || "0");

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
          The validator-set staking upgrade is not deployed on this network yet. Set admission, the governance link
          and the emission schedule read as unset and cannot be voted on until the new StratoStaking and
          ValidatorRegistry are live. Commission and operator listing continue to work against the deployed contracts.
        </div>
      )}

      {isV2 && (
        <Card>
          <CardHeader>
            <CardTitle>The commitment</CardTitle>
            <CardDescription>Fixed in the contract; a change is a logic upgrade under the network's extraordinary process, never a vote.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <p>Self-bond to join or rejoin: <span className="font-medium">{fromWad(info.minStake)} STRATO</span> of the operator's own</p>
            <p>Notice (commission raise, handover, removal), stake qualification, readiness trial, reentry: <span className="font-medium">{days(info.noticeSeconds)}</span></p>
            <p>Readiness evidence is good for <span className="font-medium">{days(info.readinessWindowSeconds)}</span>; a change must leave <span className="font-medium">{(Number(info.readyWeightBps || "0") / 100).toFixed(0)}%</span> of the set's weight ready or not lower the share</p>
            <p>Set readiness now: <span className="font-medium">{(readyBps / 100).toFixed(0)}%</span> ({fromWad(info.readyWeight || "0")} of {fromWad(info.consensusWeight || "0")} STRATO)</p>
            <p>A finalised block is paid for at most <span className="font-medium">{Math.round(Number(info.maxCreditedGapSeconds || "0") / 60)} minutes</span> of schedule; the rest of a gap stays in the reserve</p>
            <p>Anyone may remove a validator after <span className="font-medium">{info.livenessMissLimit}</span> consecutive missed proposals; two membership changes a block, a replacement counting as two</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Validator set</CardTitle>
          <CardDescription>Set size, and the agreed block from which anyone may seat a ready validator. The block is movable until it passes and admission never closes again.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {paramGrid([
            { key: "maxActiveValidators", label: "Max active validators" },
            { key: "hardCapActiveValidators", label: "Hard cap (only lowers)" },
          ], setParams, setSetParams)}
          <Button size="sm" disabled={blocked} onClick={() => run("set-params", () => api.patch("/staking/admin/set-params", setParams), "Validator set vote")}>
            {label("set-params", "Save set size")}
          </Button>
          {isV2 && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-muted-foreground">Admission opens at block ({info.joinsOpen ? "open" : Number(info.joinsOpenFromBlock || "0") > 0 ? "agreed, not yet reached" : "not agreed"})</span>
                <Input value={joinsOpenFromBlock} onChange={(event) => setJoinsOpenFromBlock(event.target.value)} className="w-48" />
              </label>
              <Button size="sm" variant="outline" disabled={blocked || info.joinsOpen || !/^[1-9]\d*$/.test(joinsOpenFromBlock)} onClick={() => run("joins-from", () => api.patch("/staking/admin/joins-open-from-block", { blockNumber: joinsOpenFromBlock }), "Admission block vote")}>
                {label("joins-from", "Set block")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isV2 && (
        <Card>
          <CardHeader>
            <CardTitle>Emission schedule</CardTitle>
            <CardDescription>
              Pays each finalised block's producer E0 × √(S / S0) × (R / R0) STRATO a year, S the earning set's stake and R the
              reserve left. Committed once, after the reserve has been funded with at least R0 by a direct fundRewardReserve
              transaction (see the staking runbook); no pause, restart or re-calibration. Top-ups raise R only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reserve {fromWad(info.rewardReserve || "0")} STRATO · earning stake {fromWad(info.eligibleStake || "0")} STRATO · released {fromWad(info.totalEmitted || "0")} STRATO · current rate{" "}
              {fromWad(info.emissionAnnualRate || "0")} STRATO/year · {committed
                ? `committed, ${Number(info.emissionStart) > Date.now() / 1000 ? "starts" : "started"} ${new Date(Number(info.emissionStart) * 1000).toLocaleString()}`
                : "not committed"}
            </p>
            {!committed && (
              <>
                {paramGrid([
                  { key: "e0", label: "E0 (STRATO a year at S0 with R0 in reserve)" },
                  { key: "s0", label: "S0 (STRATO of earning stake)" },
                  { key: "r0", label: "R0 (STRATO in reserve; must already be funded)" },
                ], emission, setEmission, (
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground">Start (your local time; blank = now)</span>
                    <Input type="datetime-local" value={emission.start ?? ""} onChange={(event) => setEmission({ ...emission, start: event.target.value })} />
                  </label>
                ))}
                <Button size="sm" disabled={blocked} onClick={() => run("emission", () => api.post("/staking/admin/emission-schedule", {
                  e0: toWad(emission.e0 || "0"),
                  s0: toWad(emission.s0 || "0"),
                  r0: toWad(emission.r0 || "0"),
                  startTime: fromDateTimeLocal(emission.start || "") || "0",
                }), "Emission commitment vote")}>
                  {label("emission", "Commit emission schedule")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Governance link</CardTitle>
          <CardDescription>Wire MercataGovernance (0x100) to the staking contract, once, and bound the consensus set. The link has no off switch.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button size="sm" variant="outline" disabled={blocked} onClick={() => run("gov-staking", () => api.patch("/staking/admin/governance/staking-contract", {}), "Governance staking-contract vote")}>
            {label("gov-staking", "Point governance at staking")}
          </Button>
          <Button size="sm" disabled={blocked || info.governanceSyncEnabled} onClick={() => run("gov-sync", () => api.patch("/staking/admin/governance", {}), "Governance link vote")}>
            {label("gov-sync", info.governanceSyncEnabled ? "Staking → governance wired" : "Wire staking → governance")}
          </Button>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Governance hard cap</span>
            <Input value={hardCap} onChange={(event) => setHardCap(event.target.value)} placeholder="50" className="w-28" />
          </label>
          <Button size="sm" variant="outline" disabled={blocked || !/^\d+$/.test(hardCap)} onClick={() => run("gov-cap", () => api.patch("/staking/admin/governance/hard-cap", { hardCap }), "Governance hard-cap vote")}>
            {label("gov-cap", "Set hard cap")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operators</CardTitle>
          <CardDescription>
            {isV2
              ? "List a validator under an operator (it still has to self-bond, pass the readiness trial and activate). A change of operator is the validator key's decision. Removal is announced with published grounds and executes a week later; the emergency path removes one validator at once, with grounds."
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
          {!isV2 && (
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
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{isV2 ? "Validator" : "Operator"}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{isV2 ? "Operator" : "Validator"}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Stake</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Blocks / missed{isV2 ? " / in a row" : ""}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {info.validators.map((row) => {
                  const key = rowKey(row);
                  // v1 rows are operators with an optional bound validator; v2 rows are validators with an operator.
                  const secondary = isV2 ? row.operator : row.validatorAddress;
                  const target = isV2 ? { validator: key } : { operator: key };
                  const rowGrounds = grounds[key] || "";
                  const misses = Number(row.consecutiveMisses || "0");
                  return (
                    <tr key={key} className="border-t border-border/50">
                      <td className="px-3 py-2">
                        <p className="font-medium">{row.name || truncateAddress(key, 8, 6)}</p>
                        <p className="text-xs text-muted-foreground">{key}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">{secondary ? truncateAddress(secondary, 8, 6) : "—"}</td>
                      <td className="px-3 py-2">
                        <ValidatorStatusBadge validator={row} />
                        {isV2 && row.status === 2 && <p className="mt-1 text-xs text-muted-foreground">{row.isReady ? "ready" : "no fresh evidence"}</p>}
                      </td>
                      <td className="px-3 py-2 text-right">{fromWad(row.totalStake)}</td>
                      <td className="px-3 py-2 text-right">{row.blocksProposed} / {row.missedProposals}{isV2 ? ` / ${row.consecutiveMisses || "0"}` : ""}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          {row.isWaiter && (
                            <Button size="sm" variant="outline" disabled={blocked} onClick={() => run(`activate-${key}`, () => api.post("/staking/activate", target), "Activation submitted")}>
                              {label(`activate-${key}`, "Activate")}
                            </Button>
                          )}
                          {isV2 && row.status === 2 && missLimit > 0 && misses >= missLimit && (
                            <Button size="sm" variant="outline" disabled={blocked} onClick={() => run(`misses-${key}`, () => api.post("/staking/remove-for-misses", target), "Liveness removal submitted")}>
                              {label(`misses-${key}`, "Remove for misses")}
                            </Button>
                          )}
                          {row.status !== 3 && isV2 && (
                            <>
                              <Input value={rowGrounds} onChange={(event) => setGrounds({ ...grounds, [key]: event.target.value })} placeholder="Published grounds" className="w-56" />
                              <Button size="sm" variant="outline" disabled={busy !== null || !rowGrounds.trim()} onClick={() => run(`announce-${key}`, () => api.delete("/staking/admin/operators", { data: { ...target, step: "announce", grounds: rowGrounds.trim() } }), "Removal announced vote")}>
                                {label(`announce-${key}`, "Announce removal")}
                              </Button>
                              <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run(`remove-${key}`, () => api.delete("/staking/admin/operators", { data: { ...target, step: "execute" } }), "Removal vote")}>
                                {label(`remove-${key}`, "Remove (after notice)")}
                              </Button>
                              <Button size="sm" variant="destructive" disabled={busy !== null || !rowGrounds.trim()} onClick={() => run(`emergency-${key}`, () => api.delete("/staking/admin/operators", { data: { ...target, step: "emergency", grounds: rowGrounds.trim() } }), "Emergency removal vote")}>
                                {label(`emergency-${key}`, "Emergency")}
                              </Button>
                            </>
                          )}
                          {row.status !== 3 && !isV2 && (
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
              {label("reconcile", "Promote ready waiters (reconcile)")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StakingAdminTab;
