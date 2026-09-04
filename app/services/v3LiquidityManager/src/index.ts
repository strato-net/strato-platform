import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { loadConfig } from "./config";
import { AlertState } from "./state";
import { Monitor } from "./monitor";

const log = (msg: string) => console.log(`${new Date().toISOString()} [service] ${msg}`);

async function main(): Promise<void> {
  const cfg = loadConfig();
  const state = new AlertState(cfg.stateFile, cfg.alertCooldownHours);
  const monitor = new Monitor(cfg, state);

  if (process.argv.includes("--once")) {
    await monitor.runCycle();
    console.log(JSON.stringify(monitor.statuses, null, 2));
    const failed = Object.values(monitor.statuses).some((s) => s.error);
    process.exit(failed ? 1 : 0);
  }

  const app = express();
  app.get("/health", (_req, res) => {
    res.status(monitor.healthy ? 200 : 500).json({
      status: monitor.healthy,
      lastCycleAt: monitor.lastCycleAt ? new Date(monitor.lastCycleAt).toISOString() : null,
      pools: monitor.statuses,
    });
  });
  app.listen(cfg.healthPort, () => log(`health endpoint on :${cfg.healthPort}/health`));

  const pairCount = cfg.accounts.reduce((n, a) => n + a.pools.length, 0);
  log(
    `watching ${pairCount} account-pool pair(s) across ${cfg.accounts.length} account(s) every ${cfg.pollIntervalSeconds}s ` +
      `(ε = ${cfg.epsilonAbsPct !== undefined ? `±${cfg.epsilonAbsPct}% abs` : `${cfg.epsilonFactor} × inner layer width`}, ` +
      `cooldown ${cfg.alertCooldownHours}h)`
  );

  const loop = async (): Promise<void> => {
    try {
      await monitor.runCycle();
    } catch (err: any) {
      log(`cycle failed: ${err.message || err}`);
    } finally {
      setTimeout(loop, cfg.pollIntervalSeconds * 1000);
    }
  };
  await loop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
