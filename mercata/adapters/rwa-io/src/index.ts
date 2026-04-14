import cron from "node-cron";
import { config } from "./config";
import { logInfo, logError } from "./logger";
import { pushTokenMetrics, clearCaches } from "./tokenMetrics";

async function tick(): Promise<void> {
  clearCaches();

  const tokenPushes = config.tokens.map((t) => pushTokenMetrics(t));
  const results = await Promise.allSettled(tokenPushes);

  for (const r of results) {
    if (r.status === "rejected") {
      logError("Push failed", r.reason);
    }
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
