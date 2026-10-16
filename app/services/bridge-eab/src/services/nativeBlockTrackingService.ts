import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NativeRedemptionHealth, NativeScanCheckpoint } from "../types";
import { HEALTH_POLL_TIMEOUT_MS } from "../config";

export class NativeBlockTrackingService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file = path.join(process.cwd(), "data", "nativeLastProcessedBlocks.json")) {}

  private async load(): Promise<Record<string, NativeScanCheckpoint>> {
    let raw: Record<string, number | NativeScanCheckpoint>;
    try { raw = JSON.parse(await fs.readFile(this.file, "utf8")); }
    catch (error: any) { if (error.code === "ENOENT") return {}; throw error; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid native scan journal");
    const result: Record<string, NativeScanCheckpoint> = {};
    for (const [chain, value] of Object.entries(raw)) {
      const state = typeof value === "number" ? { block: value, reconciliationBlock: 0 } : value;
      if (!/^\d+$/.test(chain) || !state || ![state.block, state.reconciliationBlock].every(n => Number.isSafeInteger(n) && n >= 0) ||
          (state.hash !== undefined && !/^0x[0-9a-f]{64}$/i.test(state.hash)) ||
          (state.bridge !== undefined && !/^0x[0-9a-f]{40}$/i.test(state.bridge))) throw new Error("Invalid native scan journal");
      if ([state.confirmedHead, state.forwardProgressAt, state.auditProgressAt]
          .some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) throw new Error("Invalid native scan progress");
      if (state.pendingRedemptions !== undefined) {
        if (!Array.isArray(state.pendingRedemptions)) throw new Error("Invalid native pending redemptions");
        const identities = new Set<string>();
        for (const pending of state.pendingRedemptions) {
          const deposit = pending?.deposit;
          const identity = `${deposit?.externalBridge?.toLowerCase()}:${deposit?.externalRedemptionId}`;
          if (!pending || !Number.isSafeInteger(pending.block) || pending.block < 0 ||
              (pending.observedAt !== undefined && (!Number.isSafeInteger(pending.observedAt) || pending.observedAt < 0)) ||
              !/^0x[0-9a-f]{64}$/i.test(pending.blockHash || "") || !deposit ||
              String(deposit.externalChainId) !== chain ||
              ![deposit.externalBridge, deposit.externalSender, deposit.representationToken, deposit.stratoRecipient]
                .every(value => /^0x[0-9a-f]{40}$/i.test(value || "")) ||
              !/^0x[0-9a-f]{64}$/i.test(deposit.externalTxHash || "") ||
              !/^\d+$/.test(String(deposit.externalRedemptionId)) || BigInt(deposit.externalRedemptionId) <= 0n ||
              !/^\d+$/.test(deposit.stratoTokenAmount) || BigInt(deposit.stratoTokenAmount) <= 0n ||
              (deposit.actionToken !== undefined && !/^0x[0-9a-f]{40}$/i.test(deposit.actionToken)) ||
              (deposit.minFinalOut !== undefined && !/^\d+$/.test(deposit.minFinalOut)) ||
              (deposit.actionToken && !/^0x0{40}$/i.test(deposit.actionToken) && BigInt(deposit.minFinalOut || "0") <= 0n) ||
              identities.has(identity)) throw new Error("Invalid native pending redemption");
          identities.add(identity);
        }
      }
      result[chain] = state;
    }
    return result;
  }

  async getCheckpoint(chainId: number): Promise<NativeScanCheckpoint> {
    await this.queue;
    return (await this.load())[String(chainId)] || { block: 0, reconciliationBlock: 0 };
  }

  async getChainIds(): Promise<number[]> {
    await this.queue;
    return Object.keys(await this.load()).map(chain => {
      const chainId = Number(chain);
      if (!Number.isSafeInteger(chainId) || chainId <= 0 || String(chainId) !== chain) throw new Error("Invalid native journal chain ID");
      return chainId;
    });
  }

  async getHealth(): Promise<Record<string, NativeRedemptionHealth>> {
    await this.queue;
    const now = Date.now();
    return Object.fromEntries(Object.entries(await this.load()).map(([chain, state]) => {
      const pending = state.pendingRedemptions || [];
      const ages = pending.map(entry => entry.observedAt === undefined ? null : Math.max(0, now - entry.observedAt));
      const lag = state.confirmedHead === undefined ? null : Math.max(0, state.confirmedHead - state.block);
      return [chain, {
        forwardBlock: state.block, confirmedHead: state.confirmedHead ?? null, forwardLag: lag,
        forwardStalled: lag !== null && lag > 0 && state.forwardProgressAt !== undefined && now - state.forwardProgressAt > HEALTH_POLL_TIMEOUT_MS,
        auditCursor: state.reconciliationBlock,
        auditStalled: state.auditProgressAt !== undefined && now - state.auditProgressAt > HEALTH_POLL_TIMEOUT_MS,
        pendingCount: pending.length,
        oldestPendingAgeMs: !ages.length || ages.some(age => age === null) ? null : ages.reduce<number>((oldest, age) => Math.max(oldest, age!), 0),
      }];
    }));
  }

  async saveCheckpoint(chainId: number, state: NativeScanCheckpoint): Promise<void> {
    const run = this.queue.then(async () => {
      const data = await this.load();
      data[String(chainId)] = state;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        const file = await fs.open(temp, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
        await fs.rename(temp, this.file);
        const dir = await fs.open(path.dirname(this.file), "r");
        try { await dir.sync(); } finally { await dir.close(); }
      } finally { await fs.unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export const nativeBlockTrackingService = new NativeBlockTrackingService();
