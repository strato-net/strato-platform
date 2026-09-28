import { promises as fs, mkdirSync } from 'fs';
import path from "path";
import { ERROR_FILE_NAME, HEALTH_POLL_TIMEOUT_MS } from "../config";
import { PollHealthState } from "../types";

const DATA_DIR = path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });
const ERROR_FILE_PATH = path.join(DATA_DIR, ERROR_FILE_NAME);

export class HealthMonitor {
  private ready = false;
  private polls = new Map<string, PollHealthState>();
  private operations = new Map<string, number>();

  markReady() {
    this.ready = true;
  }

  beginPoll(name: string, intervalMs: number): boolean {
    const previous = this.polls.get(name);
    if (previous?.running) return false;
    this.polls.set(name, {
      intervalMs,
      startedAt: Date.now(),
      completedAt: previous?.completedAt,
      running: true,
      failed: previous?.failed ?? false,
      runFailed: false,
    });
    return true;
  }

  failPoll(name: string) {
    const poll = this.polls.get(name);
    if (poll) poll.failed = poll.runFailed = true;
  }

  finishPoll(name: string) {
    const poll = this.polls.get(name);
    if (!poll) return;
    poll.running = false;
    poll.completedAt = Date.now();
    poll.failed = poll.runFailed;
  }

  beginOperation(name: string) {
    this.operations.set(name, Date.now());
  }

  finishOperation(name: string) {
    this.operations.delete(name);
  }

  snapshot() {
    const now = Date.now();
    const checks: Record<string, string> = {};
    for (const [name, poll] of this.polls) {
      const stale = poll.running
        ? now - poll.startedAt > HEALTH_POLL_TIMEOUT_MS
        : now - (poll.completedAt ?? poll.startedAt) > poll.intervalMs + HEALTH_POLL_TIMEOUT_MS;
      checks[name] = stale ? "stalled" : poll.failed ? "failed"
        : poll.completedAt === undefined ? "starting" : "ok";
    }
    for (const [name, startedAt] of this.operations) {
      if (now - startedAt > HEALTH_POLL_TIMEOUT_MS) checks[name] = "stalled";
    }
    return {
      status: this.ready && this.polls.size > 0 && Object.values(checks).every((state) => state === "ok"),
      ready: this.ready,
      checks,
    };
  }
  
  async appendToErrorFile(error_data) {
    try {
      const errorJsonString = JSON.stringify({timestamp: new Date().toISOString(), error: error_data})
      await fs.appendFile(ERROR_FILE_PATH, errorJsonString + '\n');
      console.log('Added the error message to the error file.', errorJsonString);
    } catch (err) {
      console.error('WARNING! Error occurred while appending to the file:', err);
    }
  }
  
  async errorFileExists() {
    try {
      const stats = await fs.stat(ERROR_FILE_PATH);
      return stats.size > 0
    } catch (err: any) {
      if (err && err['code'] && err['code'] === 'ENOENT') {
        return false
      } else {
        console.error(`Error occurred when checking if error file exists`, err)
        await this.appendToErrorFile('An error occurred while checking the error file: ' + err.message);
        return true;
      }
    }
  }
}

export const healthMonitor = new HealthMonitor();
