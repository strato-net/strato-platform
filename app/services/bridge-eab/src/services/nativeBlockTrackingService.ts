import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NativeScanCheckpoint } from "../types";

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
      result[chain] = state;
    }
    return result;
  }

  async getCheckpoint(chainId: number): Promise<NativeScanCheckpoint> {
    await this.queue;
    return (await this.load())[String(chainId)] || { block: 0, reconciliationBlock: 0 };
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
