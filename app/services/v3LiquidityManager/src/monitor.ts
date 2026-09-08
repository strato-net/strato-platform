import axios from "axios";
import { Config } from "./config";
import { AlertKind, AlertState } from "./state";
import { notify } from "./notify";

const WAD = 1e18;
const log = (msg: string) => console.log(`${new Date().toISOString()} [monitor] ${msg}`);

interface Finding {
  kind: AlertKind;
  severity: "alert" | "warn";
  line: string;
}

export interface PoolStatus {
  account: string;
  pool: string;
  pair?: string;
  checkedAt: string;
  error?: string;
  layers?: number;
  mu?: number;
  oracle?: number;
  poolPrice?: number;
  driftPct?: number;
  epsilonPct?: number;
  findings: string[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fmt = (n: number, dp = 4): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });

const shortAddr = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

export class Monitor {
  statuses: Record<string, PoolStatus> = {};
  lastCycleAt: number | null = null;

  constructor(private cfg: Config, private state: AlertState) {}

  private get pairKeys(): string[] {
    return this.cfg.accounts.flatMap((a) => a.pools.map((p) => `${a.account}:${p}`));
  }

  get healthy(): boolean {
    if (this.lastCycleAt === null) return true; // still starting up
    const stale = Date.now() - this.lastCycleAt > 3 * this.cfg.pollIntervalSeconds * 1000;
    const keys = this.pairKeys;
    const allErrored = keys.length > 0 && keys.every((k) => this.statuses[k]?.error);
    return !stale && !allErrored;
  }

  async runCycle(): Promise<void> {
    for (const { account, pools } of this.cfg.accounts) {
      for (const pool of pools) {
        try {
          await this.checkPool(account, pool);
        } catch (err: any) {
          const detail = err.response ? JSON.stringify(err.response.data) : err.message;
          this.statuses[`${account}:${pool}`] = {
            account,
            pool,
            checkedAt: new Date().toISOString(),
            error: detail,
            findings: [],
          };
          log(`ERROR checking ${pool} for ${shortAddr(account)}: ${detail}`);
        }
      }
    }
    this.lastCycleAt = Date.now();
  }

  private async checkPool(account: string, pool: string): Promise<void> {
    const { cfg, state } = this;
    const pairKey = `${account}:${pool}`;
    const { data: p } = await axios.get(`${cfg.apiBase}/poolv3/pools/${pool}`);
    const pair = `${p.token0.symbol}/${p.token1.symbol}`;
    const { data: positions } = await axios.get(`${cfg.apiBase}/poolv3/positions`, {
      params: { poolAddress: pool },
      headers: { "X-Wallet-Address": account },
    });
    const live = (positions as any[]).filter((pos) => BigInt(pos.liquidity) > 0n);

    const oracle = Number(p.oraclePriceWad) / WAD;
    const poolPrice = Number(p.priceWad) / WAD;
    const findings: Finding[] = [];

    if (p.isDisabled || p.isPaused) {
      findings.push({
        kind: "pool-paused",
        severity: "warn",
        line: `pool is ${p.isDisabled ? "DISABLED" : "PAUSED"} — minting is blocked, a reposition would fail`,
      });
    } else {
      state.clear(pairKey, "pool-paused");
    }

    if (!(oracle > 0)) {
      findings.push({
        kind: "oracle-stale",
        severity: "warn",
        line: "oracle price is 0/unavailable — drift cannot be judged",
      });
    } else {
      state.clear(pairKey, "oracle-stale");
    }

    if (live.length === 0) {
      findings.push({
        kind: "no-ladder",
        severity: "warn",
        line: `no live positions held by ${account} in this pool`,
      });
    } else {
      state.clear(pairKey, "no-ladder");
    }

    // μ = median of the layers' geometric centers; ε from the innermost layer's half-width
    let mu: number | undefined;
    let driftPct: number | undefined;
    let epsilonPct: number | undefined;
    let widths: number[] = [];
    if (live.length > 0) {
      const bounds = live.map((pos) => ({
        lo: Number(pos.priceLowerWad) / WAD,
        hi: Number(pos.priceUpperWad) / WAD,
      }));
      mu = median(bounds.map((b) => Math.sqrt(b.lo * b.hi)));
      const halfWidths = bounds.map((b) => ((b.hi - b.lo) / (b.hi + b.lo)) * 100);
      widths = [...halfWidths].sort((a, b) => a - b).map((w) => Number(w.toFixed(2)));
      epsilonPct = cfg.epsilonAbsPct ?? cfg.epsilonFactor * widths[0];

      if (oracle > 0) {
        driftPct = (oracle / mu - 1) * 100;
        if (Math.abs(driftPct) > epsilonPct) {
          findings.push({
            kind: "recenter",
            severity: "alert",
            line: `oracle is ${fmt(driftPct, 2)}% from ladder center μ=${fmt(mu)} (ε ±${fmt(epsilonPct, 2)}%) — reposition recommended`,
          });
        } else {
          state.clear(pairKey, "recenter");
        }
      }
    }

    if (oracle > 0 && poolPrice > 0) {
      const dislocationPct = (poolPrice / oracle - 1) * 100;
      if (Math.abs(dislocationPct) > cfg.dislocationPct) {
        findings.push({
          kind: "dislocation",
          severity: "warn",
          line: `pool price is ${fmt(dislocationPct, 2)}% off the oracle (threshold ±${fmt(cfg.dislocationPct, 2)}%) — arbitrage is not keeping up or the oracle is stale`,
        });
      } else {
        state.clear(pairKey, "dislocation");
      }
    }

    this.statuses[pairKey] = {
      account,
      pool,
      pair,
      checkedAt: new Date().toISOString(),
      layers: live.length,
      mu,
      oracle,
      poolPrice,
      driftPct,
      epsilonPct,
      findings: findings.map((f) => `${f.kind}: ${f.line}`),
    };
    log(
      `${pair} acct=${shortAddr(account)} layers=${live.length} μ=${mu !== undefined ? fmt(mu) : "-"} oracle=${fmt(oracle)} poolPrice=${fmt(poolPrice)} ` +
        `drift=${driftPct !== undefined ? fmt(driftPct, 2) + "%" : "-"} findings=${findings.length}`
    );

    // one message per account-pool pair per cycle, gated per finding-kind by the hysteresis state
    const due = findings.filter((f) => state.shouldAlert(pairKey, f.kind, { mu, driftPct }));
    if (due.length === 0) return;

    const primary = due.find((f) => f.severity === "alert") ?? due[0];
    const subject = `[v3-liquidity] ${primary.kind.toUpperCase()} ${pair} [${shortAddr(account)}]: ${primary.line.split(" — ")[0]}`;
    const lines = [
      `Account:    ${account}`,
      `Pool:       ${pool} (${pair}, fee ${p.fee / 10000}%)`,
      `Ladder μ:   ${mu !== undefined ? fmt(mu) : "n/a"} (${live.length} layers${widths.length ? `, inner ±${widths[0]}%` : ""})`,
      `Oracle:     ${fmt(oracle)}${driftPct !== undefined ? ` → drift ${fmt(driftPct, 2)}% (ε ±${fmt(epsilonPct!, 2)}%)` : ""}`,
      `Pool price: ${fmt(poolPrice)}${oracle > 0 && poolPrice > 0 ? ` (${fmt((poolPrice / oracle - 1) * 100, 2)}% vs oracle)` : ""}`,
      "",
      "Findings:",
      ...findings.map((f) => `  - [${f.severity}] ${f.line}`),
    ];
    if (findings.some((f) => f.kind === "recenter")) {
      const configuredWidths = this.cfg.ladderWidths[pool];
      lines.push(
        "",
        `Reposition — run as account ${account} (exits all its layers, reinvests principal + fees, recenters on the oracle):`,
        `  cd app/scripts && node positionV3Liquidity.js --pool ${pool} --widths ${configuredWidths ?? widths.join(",")} --execute`
      );
      if (!configuredWidths)
        lines.push(
          "  (widths reconstructed from chain include tick-snapping — set LADDER_WIDTHS to pin the canonical ladder and avoid it widening over repeated repositions)"
        );
    }
    await notify(this.cfg, subject, lines.join("\n"));
    for (const f of due) state.record(pairKey, f.kind, { mu, driftPct });
  }
}
