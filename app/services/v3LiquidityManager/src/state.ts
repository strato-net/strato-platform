import fs from "fs";

export type AlertKind = "recenter" | "dislocation" | "oracle-stale" | "pool-paused" | "no-ladder";

interface AlertRecord {
  lastAlertAt: string;
  /** ladder center at alert time — a changed μ means the ladder was repositioned */
  mu?: number;
  driftPct?: number;
}

type StateShape = Record<string, Partial<Record<AlertKind, AlertRecord>>>;

/** File-backed hysteresis: while a condition persists, re-alert only after the
 *  cooldown, if drift has doubled, or if the ladder was repositioned (new μ). */
export class AlertState {
  private state: StateShape = {};

  constructor(private file: string, private cooldownHours: number) {
    try {
      this.state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      this.state = {};
    }
  }

  private save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  shouldAlert(pool: string, kind: AlertKind, ctx?: { mu?: number; driftPct?: number }): boolean {
    const rec = this.state[pool]?.[kind];
    if (!rec) return true;
    if (kind === "recenter" && ctx?.mu !== undefined && rec.mu !== undefined) {
      // μ moved by more than 0.1% → ladder was re-minted since the last alert
      if (Math.abs(ctx.mu / rec.mu - 1) > 0.001) return true;
    }
    const cooldownMs = this.cooldownHours * 3600 * 1000;
    if (Date.now() - Date.parse(rec.lastAlertAt) >= cooldownMs) return true;
    if (
      kind === "recenter" &&
      ctx?.driftPct !== undefined &&
      rec.driftPct !== undefined &&
      Math.abs(ctx.driftPct) >= 2 * Math.abs(rec.driftPct)
    )
      return true;
    return false;
  }

  record(pool: string, kind: AlertKind, ctx?: { mu?: number; driftPct?: number }): void {
    if (!this.state[pool]) this.state[pool] = {};
    this.state[pool][kind] = { lastAlertAt: new Date().toISOString(), mu: ctx?.mu, driftPct: ctx?.driftPct };
    this.save();
  }

  clear(pool: string, kind: AlertKind): void {
    if (this.state[pool]?.[kind]) {
      delete this.state[pool][kind];
      this.save();
    }
  }
}
