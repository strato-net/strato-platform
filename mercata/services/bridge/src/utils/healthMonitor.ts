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
    let details: any = null;
    
    if (existsSync(ERROR_FILE)) {
      try {
        const lines = readFileSync(ERROR_FILE, "utf8").trim().split("\n");
        const last = JSON.parse(lines[lines.length - 1]);
        details = {
          lastError: last.msg,
          timestamp: last.ts,
          context: last.context,
          errorCount: lines.length,
        };
      } catch {}
    }

    return {
      status: this.isHealthy() ? "healthy" : "unhealthy",
      lastError: this.lastError,
      errorFileExists: !this.isHealthy(),
      errorDetails: details,
    };
  }
}

export const healthMonitor = new HealthMonitor();