import { promises as fs } from "fs";
import path from "path";
import { logInfo, logError } from "../observability/logger";
import { BONUS_TRACKING_FILE } from "../config/runtimeConfig";
import { BonusBalanceSnapshots, BonusCredit, BonusRunState } from "../../shared/types";
import { writeJsonFileAtomic } from "./atomicJson.store";
import { normalizeAddressNoPrefix } from "../../shared/core/address";

const BONUS_TRACKING_PATH = path.join(process.cwd(), BONUS_TRACKING_FILE);

const DEFAULT_STATE: BonusRunState = {
  lastSuccessfulTimestamp: null,
  pendingCredits: [],
  balanceSnapshots: {},
};

const isValidBalanceString = (value: unknown): value is string => {
  if (typeof value !== "string" || value.trim().length === 0) return false;

  try {
    return BigInt(value) >= 0n;
  } catch {
    return false;
  }
};

const normalizeBalanceSnapshots = (value: unknown): BonusBalanceSnapshots => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalizedSnapshots: BonusBalanceSnapshots = {};
  for (const [token, userSnapshots] of Object.entries(value)) {
    if (!userSnapshots || typeof userSnapshots !== "object" || Array.isArray(userSnapshots)) continue;

    const tokenKey = normalizeAddressNoPrefix(token);
    const normalizedUserSnapshots: Record<string, string[]> = {};
    for (const [user, snapshots] of Object.entries(userSnapshots as Record<string, unknown>)) {
      if (!Array.isArray(snapshots)) continue;

      const normalizedSnapshotsForUser = snapshots
        .filter(isValidBalanceString)
        .map((snapshot) => BigInt(snapshot).toString());
      if (normalizedSnapshotsForUser.length === 0) continue;

      normalizedUserSnapshots[normalizeAddressNoPrefix(user)] = normalizedSnapshotsForUser;
    }

    normalizedSnapshots[tokenKey] = normalizedUserSnapshots;
  }

  return normalizedSnapshots;
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
    balanceSnapshots: normalizeBalanceSnapshots(x.balanceSnapshots),
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

  async replacePending(credits: BonusCredit[]): Promise<void> {
    const state = this.cached ?? await this.getState();
    await this.writeToFile({ ...state, pendingCredits: [...credits] });
  }
}

export const bonusTrackingService = new BonusTrackingService();
