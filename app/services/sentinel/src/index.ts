import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { loadConfig } from "./config";
import { StateStore } from "./state";
import { Monitor } from "./monitor";

const log = (msg: string) => console.log(`${new Date().toISOString()} [service] ${msg}`);

async function main(): Promise<void> {
  const cfg = loadConfig();
  const monitor = new Monitor(cfg, new StateStore(cfg.stateFile));

  if (process.argv.includes("--once")) {
    await monitor.runCycle();
    process.exit(Object.keys(monitor.errors).length ? 1 : 0);
  }

  const app = express();
  app.get("/health", (_req, res) => {
    const { proxies, ...cursors } = monitor.store.state;
    res.status(monitor.healthy ? 200 : 500).json({
      status: monitor.healthy,
      lastCycleAt: monitor.lastCycleAt ? new Date(monitor.lastCycleAt).toISOString() : null,
      cursors,
      errors: monitor.errors,
    });
  });
  app.listen(cfg.healthPort, () => log(`health endpoint on :${cfg.healthPort}/health`));

  log(
    `watching ${cfg.cirrusBase} every ${cfg.pollIntervalSeconds}s ` +
      `(${Object.keys(cfg.knownExecutors).length} known executor(s), ` +
      `${cfg.evmChains.length} external chain(s), slack ${cfg.slack ? "on" : "off — log only"})`
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
