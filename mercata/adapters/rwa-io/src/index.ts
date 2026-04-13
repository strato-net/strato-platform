import cron from "node-cron";
import { config } from "./config";
import { logInfo, logError } from "./logger";
import { pushTvl } from "./tvl";

async function tick(): Promise<void> {
  try {
    await pushTvl();
  } catch (err) {
    logError("TVL push failed", err);
  }
}

async function main(): Promise<void> {
  logInfo("Starting RWA.io adapter", {
    slug: config.rwaIo.slug,
    cronSchedule: config.cronSchedule,
    tvlEndpoint: config.strato.tvlEndpoint,
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
