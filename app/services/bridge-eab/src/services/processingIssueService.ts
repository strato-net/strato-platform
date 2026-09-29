import type { BridgeProcessingIssuesPage } from "@strato/shared-types";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROCESSING_RETRY_BASE_MS, PROCESSING_RETRY_MAX_MS, PROCESSING_ALERT_GRACE_MS,
  PROCESSING_REMINDER_MS, PROCESSING_HISTORY_MS, config, getExternalBridgeExecutorKmsConfig } from "../config";
import { ProcessingContext, ProcessingIssue, ProcessingJournal, ProcessingRecord, DepositArgs, WithdrawalInfo, NativeWithdrawalInfo } from "../types";
import { classifyProcessingError, processingKey } from "../utils/processingIssues";
import { logInfo } from "../utils/logger";
import { sendProcessingIssueEmail } from "./emailService";

const fingerprint = (issues: ProcessingIssue[]) => JSON.stringify(issues.map(({ code, details }) =>
  [code, details.verifier, details.policyVersion, details.policyDigest, details.limit, details.capacity, details.refillRate]).sort());
const groupKey = (record: ProcessingRecord) => JSON.stringify([record.context.source, record.context.chainId,
  record.context.bridge.toLowerCase().replace(/^0x/, ""), record.issues.map(issue => [issue.code, issue.details.verifier,
    issue.details.account || record.context.account,
    ["DEPENDENCY_UNAVAILABLE", "FUNDING_REQUIRED"].includes(issue.code) ? "" : record.context.token,
    // Unknown failures have no proven common cause: keep them transaction-specific.
    issue.code === "UNKNOWN" ? record.context.reference : ""]).sort()]);

export class ProcessingIssueService {
  private queue: Promise<unknown> = Promise.resolve();
  private notifying = false;
  constructor(private readonly file = path.join(process.cwd(), "data", "processingIssues.json"),
    private readonly now = () => Date.now(), private readonly random = Math.random) {}

  private async load(): Promise<ProcessingJournal> {
    let state: ProcessingJournal;
    try { state = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error: any) {
      if (error.code === "ENOENT") return { version: 1, records: {}, notifications: {} };
      throw error;
    }
    if (state?.version !== 1 || !state.records || !state.notifications ||
        Array.isArray(state.records) || Array.isArray(state.notifications) ||
        Object.entries(state.records).some(([key, r]) => !r?.context || processingKey(r.context) !== key ||
          !Array.isArray(r.issues) || !r.issues.length || r.issues.some(i => !i?.code || !i.details) ||
          ![r.firstSeenAt, r.lastSeenAt, r.attempts, r.nextRetryAt].every(Number.isSafeInteger)) ||
        Object.values(state.notifications).some(n => !n?.record?.context || !Number.isSafeInteger(n.sentAt) || typeof n.fingerprint !== "string")) {
      throw new Error("Invalid processing issue journal; restore it before resuming retries");
    }
    return state;
  }

  private update<T>(fn: (state: ProcessingJournal) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.load();
      const result = fn(state);
      for (const [key, record] of Object.entries(state.records)) {
        if (record.resolvedAt && this.now() - record.resolvedAt > PROCESSING_HISTORY_MS) delete state.records[key];
      }
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        const file = await fs.open(temp, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
        await fs.rename(temp, this.file);
        const directory = await fs.open(path.dirname(this.file), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await fs.unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async snapshot(): Promise<ProcessingJournal> { await this.queue; return this.load(); }

  async list(state: "active" | "cleared", offset: number, limit: number): Promise<BridgeProcessingIssuesPage> {
    if (!["active", "cleared"].includes(state) || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid processing issue pagination");
    const records = Object.entries((await this.snapshot()).records)
      .filter(([, record]) => state === "active" ? !record.resolvedAt : !!record.resolvedAt)
      .sort(([a, x], [b, y]) => (state === "active" ? y.lastSeenAt - x.lastSeenAt : y.resolvedAt! - x.resolvedAt!) || a.localeCompare(b));
    return { items: records.slice(offset, offset + limit).map(([id, record]) => ({ id, ...record })),
      total: records.length, offset, limit, state, fetchedAt: this.now() };
  }

  async due(context: ProcessingContext): Promise<boolean> {
    const record = (await this.snapshot()).records[processingKey(context)];
    return !record || !!record.resolvedAt || record.nextRetryAt <= this.now();
  }

  async record(context: ProcessingContext, error: unknown): Promise<ProcessingIssue[]> {
    // Withdrawal workers retry unknown failures; deposits retain their review decision.
    const withdrawal = context.stage.startsWith("withdrawal-") || context.stage === "release-confirmations";
    let issues = classifyProcessingError(error).map(issue => withdrawal && issue.code === "UNKNOWN" ? { ...issue, retryable: true } : issue);
    if (context.source === "eab" && context.stage.startsWith("withdrawal") && /^\d+$/.test(context.chainId)) {
      issues = issues.map(issue => issue.code === "FUNDING_REQUIRED" && !issue.details.account
        ? { ...issue, details: { ...issue.details,
          account: getExternalBridgeExecutorKmsConfig(BigInt(context.chainId))?.address || "external-executor",
          feeAsset: "external-native-gas",
        } } : issue);
    }
    if (context.source === "eab" && context.token && issues.some(issue => issue.code === "MINT_CAPACITY")) {
      try {
        const { getMintPolicyDiagnostics, getDepositSettlementInfoByIdentity } = await import("./cirrusService");
        const [router, id] = context.reference.split(":");
        const [details, deposit] = await Promise.all([getMintPolicyDiagnostics(context.token),
          getDepositSettlementInfoByIdentity(context.chainId, router, id)]);
        issues = issues.map(issue => issue.code === "MINT_CAPACITY" ? { ...issue, details: { ...issue.details, ...details,
          ...(deposit?.stratoTokenAmount ? { required: deposit.stratoTokenAmount } : {}) } } : issue);
      } catch { /* Missing diagnostics must never mask the original blocker. */ }
    }
    const changed = await this.update(state => {
      const key = processingKey(context), old = state.records[key], now = this.now();
      const changed = !old || !!old.resolvedAt || fingerprint(old.issues) !== fingerprint(issues);
      const attempts = changed ? 1 : old.attempts + 1;
      const transient = issues.every(i => ["DEPENDENCY_UNAVAILABLE", "UNKNOWN", "CONFIRMATIONS_PENDING"].includes(i.code));
      let delay = transient ? Math.min(PROCESSING_RETRY_MAX_MS, PROCESSING_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 10)) : PROCESSING_RETRY_MAX_MS;
      const refill = issues.map(i => Number(i.details.retryAfterSeconds)).filter(n => Number.isFinite(n) && n > 0);
      if (refill.length) delay = Math.min(PROCESSING_RETRY_MAX_MS, Math.max(PROCESSING_RETRY_BASE_MS, Math.min(...refill) * 1000));
      delay = Math.min(PROCESSING_RETRY_MAX_MS, Math.round(delay * (0.9 + this.random() * 0.2)));
      state.records[key] = { context, issues, firstSeenAt: changed ? now : old.firstSeenAt,
        lastSeenAt: now, attempts, nextRetryAt: now + delay };
      return changed;
    });
    if (changed) logInfo("ProcessingIssue", "Processing blocked", { ...context, issues });
    return issues;
  }

  async resolve(context: ProcessingContext, outcome: ProcessingRecord["outcome"] = "processing_resumed") {
    const key = processingKey(context);
    const current = (await this.snapshot()).records[key];
    if (!current || current.resolvedAt) return;
    await this.update(state => {
      const record = state.records[key];
      if (record && !record.resolvedAt) { record.resolvedAt = this.now(); record.outcome = outcome; }
    });
    logInfo("ProcessingIssue", outcome === "completed" ? "Transfer completed" : "Blocker cleared; processing resumed", context);
  }

  // force keeps deadline-sensitive recovery polling active. Workers return false
  // for no-op waits; those cannot clear a previously recorded blocker.
  async run(context: ProcessingContext, action: () => Promise<unknown>, force = false): Promise<boolean> {
    if (!force && !await this.due(context)) return false;
    try { if (await action() === false) return false; }
    catch (error) { await this.record(context, error); return false; }
    await this.resolve(context);
    return true;
  }

  async notify(send = sendProcessingIssueEmail): Promise<void> {
    if (this.notifying) return;
    this.notifying = true;
    try {
      const state = await this.snapshot(), groups = new Map<string, ProcessingRecord[]>();
      for (const record of Object.values(state.records)) {
        if (record.resolvedAt || record.issues.every(i => i.code === "MANUAL_REVIEW")) continue;
        const key = groupKey(record);
        groups.set(key, [...(groups.get(key) || []), record]);
      }
      let failed = false;
      for (const [key, records] of groups) {
        const record = records[0], saved = state.notifications[key];
        const signature = fingerprint(records.flatMap(r => r.issues).filter((issue, i, all) =>
          all.findIndex(other => fingerprint([other]) === fingerprint([issue])) === i));
        const immediate = records.some(r => r.issues.some(i => !["DEPENDENCY_UNAVAILABLE", "CONFIRMATIONS_PENDING"].includes(i.code)));
        if (!immediate && records.every(r => this.now() - r.firstSeenAt < PROCESSING_ALERT_GRACE_MS)) continue;
        if (saved?.fingerprint === signature && this.now() - saved.sentAt < PROCESSING_REMINDER_MS) continue;
        try {
          await send(records, false);
          await this.update(s => { s.notifications[key] = { fingerprint: signature, sentAt: this.now(), record }; });
        } catch { failed = true; }
      }
      for (const [key, saved] of Object.entries(state.notifications)) {
        if (groups.has(key)) continue;
        const current = state.records[processingKey(saved.record.context)];
        try {
          await send([current || saved.record], true);
          await this.update(s => { delete s.notifications[key]; });
        } catch { failed = true; }
      }
      if (failed) throw new Error("Processing issue email delivery failed; notifications remain pending");
    } finally { this.notifying = false; }
  }
}

export const processingIssueService = new ProcessingIssueService();
export const notifyProcessingIssues = async () => {
  const active = Object.values((await processingIssueService.snapshot()).records).filter(r => !r.resolvedAt);
  if (active.length) {
    const { getCompletedProcessingContexts } = await import("./cirrusService");
    for (const context of await getCompletedProcessingContexts(active.map(r => r.context))) {
      await processingIssueService.resolve(context);
    }
  }
  if (config.email.approverEmails.length) await processingIssueService.notify();
};

export const depositProcessingContext = (deposit: DepositArgs, stage = "deposit-settlement"): ProcessingContext => ({
  source: "eab", chainId: String(deposit.externalChainId), bridge: config.externalAssetBridge.address!,
  reference: `${deposit.depositRouter.toLowerCase().replace(/^0x/, "")}:${deposit.depositId}`, stage, token: deposit.targetStratoToken,
});

export const withdrawalProcessingContext = (source: "eab" | "native", withdrawal: WithdrawalInfo | NativeWithdrawalInfo,
  stage = "withdrawal-processing"): ProcessingContext => ({
  source, chainId: String(withdrawal.externalChainId), bridge: source === "eab" ? config.externalAssetBridge.address! : config.nativeBridge.address!,
  reference: String(withdrawal.withdrawalId), stage, token: withdrawal.stratoToken,
});
