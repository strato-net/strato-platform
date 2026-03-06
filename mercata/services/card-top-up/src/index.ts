import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { config } from "./config";
import { runTopUpCycle } from "./services/cardTopUpService";
import { logInfo, logError } from "./utils/logger";
import { healthMonitor } from "./utils/healthMonitor";

const app = express();
const PORT = process.env.PORT || 3004;

app.get("/health", async (_, res) => {
  const errorFileExists = await healthMonitor.errorFileExists();
  res.status(errorFileExists ? 500 : 200).json({ status: !errorFileExists, message: "pong" });
});

async function startPolling(): Promise<void> {
  const intervalMs = config.polling.intervalMs;
  logInfo("CardTopUp", `Starting polling every ${intervalMs / 1000}s`);
  const poll = async () => {
    try {
      await runTopUpCycle();
    } catch (err) {
      logError("CardTopUp", err as Error, { operation: "poll" });
    }
  };
  await poll();
  setInterval(poll, intervalMs);
}

app.listen(PORT, async () => {
  try {
    const { clientId, clientSecret, discoveryUrl } = config.operator;
    if (!clientId || !clientSecret || !discoveryUrl) {
      logError(
        "CardTopUp",
        new Error("OPERATOR_CLIENT_ID, OPERATOR_CLIENT_SECRET, and OPERATOR_DISCOVERY_URL are required"),
        {}
      );
      process.exit(1);
    }
    const rpcCount = Object.keys(config.rpcUrls).length;
    if (rpcCount === 0) {
      logError("CardTopUp", new Error("EXTERNAL_CHAIN_RPC_URLS is not set or invalid JSON"), {});
      process.exit(1);
    }
    logInfo("CardTopUp", `Card top-up service listening on port ${PORT}`);
    await startPolling();
  } catch (err) {
    logError("CardTopUp", err as Error, { operation: "startup" });
    process.exit(1);
  }
});
