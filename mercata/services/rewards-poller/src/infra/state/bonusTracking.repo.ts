import { promises as fs } from "fs";
import path from "path";
import { logInfo, logError } from "../observability/logger";
import { BONUS_TRACKING_FILE } from "../config/runtimeConfig";
import { BonusRunState, BonusCredit } from "../../shared/types";
import { writeJsonFileAtomic } from "./atomicJson.store";

const BONUS_TRACKING_PATH = path.join(process.cwd(), BONUS_TRACKING_FILE);

const DEFAULT_STATE: BonusRunState = {
  lastSuccessfulTimestamp: null,
  pendingCredits: [],
};

function isValidStateShape(x: any): boolean {
  return (
    x &&
    (x.lastSuccessfulTimestamp === null || typeof x.lastSuccessfulTimestamp === "string") &&
    Array.isArray(x.pendingCredits)
  );
}

function normalizeState(x: any): BonusRunState {
  if (!isValidStateShape(x)) return { ...DEFAULT_STATE };

  return {
    lastSuccessfulTimestamp: x.lastSuccessfulTimestamp,
    pendingCredits: x.pendingCredits,
  };
}

class BonusTrackingService {
  private cached: BonusRunState | null = null;

  private async writeToFile(state: BonusRunState): Promise<void> {
    try {
      await writeJsonFileAtomic(BONUS_TRACKING_PATH, state);
      this.cached = state;
    } catch (error) {
      logError("BonusTrackingService", error as Error, {
        operation: "writeToFile",
        filePath: BONUS_TRACKING_PATH,
      });
      throw error;
    }
  }

  async getState(): Promise<BonusRunState> {
    if (this.cached) return this.cached;

    try {
      const raw = await fs.readFile(BONUS_TRACKING_PATH, "utf-8");
      const parsed = JSON.parse(raw);

      if (!isValidStateShape(parsed)) {
        logError(
          "BonusTrackingService",
          new Error(`Invalid bonus tracking file format`),
          { operation: "getState", fileLength: raw.length }
        );
        return { ...DEFAULT_STATE };
      }

      const normalized = normalizeState(parsed);
      this.cached = normalized;
      return normalized;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        logError("BonusTrackingService", error as Error, {
          operation: "getState",
          filePath: BONUS_TRACKING_PATH,
        });
      }
      return { ...DEFAULT_STATE };
    }
  }

  async updateState(state: BonusRunState): Promise<void> {
    await this.writeToFile(state);
    logInfo(
      "BonusTrackingService",
      `Updated state: pending=${state.pendingCredits.length}, lastSuccess=${state.lastSuccessfulTimestamp ?? "never"}`
    );
  }

  async clearPending(): Promise<void> {
    const state = this.cached ?? await this.getState();
    await this.writeToFile({ ...state, pendingCredits: [] });
  }

  async appendPending(credits: BonusCredit[]): Promise<void> {
    const state = this.cached ?? await this.getState();
    await this.writeToFile({ ...state, pendingCredits: [...state.pendingCredits, ...credits] });
  }

}

export const bonusTrackingService = new BonusTrackingService();
