import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class DepositAuditCursor {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file = path.join(process.cwd(), "data", "depositAuditCursors.json")) {}

  private async load(): Promise<Record<string, number>> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid deposit audit cursor");
      for (const [chain, block] of Object.entries(raw)) {
        if (!/^\d+$/.test(chain) || !Number.isSafeInteger(block) || Number(block) < 0) throw new Error("Invalid deposit audit cursor");
      }
      return raw;
    } catch (error: any) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  async get(chainId: number): Promise<number> {
    await this.queue;
    return (await this.load())[String(chainId)] || 0;
  }

  async set(chainId: number, block: number): Promise<void> {
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !Number.isSafeInteger(block) || block < 0) {
      throw new Error("Invalid deposit audit cursor");
    }
    const run = this.queue.then(async () => {
      const data = await this.load();
      data[String(chainId)] = block;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      const handle = await fs.open(temp, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, this.file);
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
  }
}

export const depositAuditCursor = new DepositAuditCursor();

export const planDepositAuditRanges = (
  head: number,
  reconciliationBlock: number,
  span: number,
): { ranges: Array<[number, number]>; nextReconciliation: number } => {
  if (!Number.isSafeInteger(head) || head < 0 || !Number.isSafeInteger(span) || span < 1) {
    throw new Error("Invalid deposit audit range");
  }
  const historyFrom = reconciliationBlock > head ? 0 : reconciliationBlock;
  const historyTo = Math.min(head, historyFrom + span - 1);
  const headFrom = Math.max(0, head - span + 1);
  const ranges: Array<[number, number]> = [[headFrom, head]];
  if (historyFrom < headFrom || historyTo > head) ranges.push([historyFrom, historyTo]);
  return { ranges, nextReconciliation: historyTo >= head ? 0 : historyTo + 1 };
};
