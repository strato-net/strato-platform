import { existsSync, readFileSync } from "fs";
import path from "path";
import { ERROR_FILE_NAME } from "../config";

const ERROR_FILE = path.join(process.cwd(), ERROR_FILE_NAME);

class HealthMonitor {
  private lastError = "";

  recordFailure(error: string) {
    this.lastError = error;
  }

  isHealthy() {
    return !existsSync(ERROR_FILE);
  }

  getStatus() {
    const exists = existsSync(ERROR_FILE);

    let details: any = null;
    if (exists) {
      try {
        const lines = readFileSync(ERROR_FILE, "utf8").trim().split("\n");
        if (lines.length) {
          const last = JSON.parse(lines[lines.length - 1]);
          details = {
            lastError: last.msg,
            timestamp: last.ts,
            context: last.context,
            errorCount: lines.length,
          };
        }
      } catch {
        details = {
          lastError: "Failed to read error file",
          errorCount: 0,
        };
      }
    }

    return {
      status: this.isHealthy() ? "healthy" : "unhealthy",
      lastError: this.lastError,
      errorFileExists: exists,
      errorDetails: details,
    };
  }
}

export const healthMonitor = new HealthMonitor();
