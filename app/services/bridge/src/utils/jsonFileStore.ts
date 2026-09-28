import { promises as fs, mkdirSync } from "fs";
import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");

export const dataFilePath = (fileName: string) => path.join(DATA_DIR, fileName);

/**
 * A JSON document kept in memory and persisted on every change. Writes go to a temporary file,
 * are fsynced, then renamed over the original, so a crash never leaves a torn file behind.
 * Updates are serialized, so concurrent callers never overwrite each other's changes.
 */
export class JsonFileStore<T extends object> {
  private cached: T | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly empty: () => T,
    // "empty" treats an unreadable file as empty; "throw" refuses to run on it
    private readonly onCorrupt: "empty" | "throw" = "throw",
  ) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  async read(): Promise<T> {
    if (this.cached) return this.cached;

    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf-8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      this.cached = this.empty();
      return this.cached;
    }

    try {
      this.cached = JSON.parse(content) as T;
    } catch (error) {
      if (this.onCorrupt === "throw") {
        throw new Error(`${this.filePath} is not valid JSON: ${(error as Error).message}`);
      }
      this.cached = this.empty();
    }
    return this.cached;
  }

  update(mutate: (data: T) => void): Promise<T> {
    const run = this.writes.then(async () => {
      const data = JSON.parse(JSON.stringify(await this.read())) as T;
      mutate(data);
      await this.write(data);
      this.cached = data;
      return data;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async write(data: T): Promise<void> {
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    const handle = await fs.open(tmpPath, "w");
    try {
      await handle.writeFile(JSON.stringify(data, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, this.filePath);
  }
}
