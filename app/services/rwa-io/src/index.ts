import { writeFileSync } from "fs";
import cron from "node-cron";
import { config } from "./config";
import { logInfo, logError } from "./logger";
import { pushTokenMetrics, clearCaches } from "./tokenMetrics";
import { pushTvl } from "./tvl";

const HEALTH_FILE = "/tmp/rwa-io-healthy";

async function tick(): Promise<void> {
  clearCaches();

  const results = await Promise.allSettled([
    pushTvl(),
    ...config.tokens.map((t) => pushTokenMetrics(t)),
  ]);

  let anyFailed = false;
  for (const r of results) {
    if (r.status === "rejected") {
      logError("Push failed", r.reason);
      anyFailed = true;
    }
  }

  if (!anyFailed) {
    writeFileSync(HEALTH_FILE, new Date().toISOString());
  }
}

async function main(): Promise<void> {
  logInfo("Starting RWA.io adapter", {
    slug: config.rwaIo.slug,
    cronSchedule: config.cronSchedule,
    tvlEndpoint: config.strato.tvlEndpoint,
    tokens: config.tokens.map((t) => t.symbol),
  });

  // Run once immediately on startup so we don't wait for the first cron tick.
  await tick();

  cron.schedule(config.cronSchedule, tick, { timezone: "UTC" });

  logInfo("Cron scheduled — adapter is running");
}

main().catch((err) => {
  logError("Fatal startup error", err);
  process.exit(1);
});
