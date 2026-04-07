import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const ERROR_FILE_NAME = "card-top-up-error.flag";
const ERROR_FILE_PATH = path.join(DATA_DIR, ERROR_FILE_NAME);

export async function appendError(data: unknown): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(
      ERROR_FILE_PATH,
      JSON.stringify({ timestamp: new Date().toISOString(), error: data }) + "\n"
    );
  } catch (err) {
    console.error("Failed to append to error file:", err);
  }
}

export async function errorFileExists(): Promise<boolean> {
  try {
    const stats = await fs.stat(ERROR_FILE_PATH);
    return stats.size > 0;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return false;
    return true;
  }
}

export const healthMonitor = { appendError, errorFileExists };
