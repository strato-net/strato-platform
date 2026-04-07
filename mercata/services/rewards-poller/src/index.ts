import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { logInfo, logError } from "./utils/logger";
import { initializeRewardsPolling } from "./polling/rewardsPolling";
import { initOpenIdConfig } from "./auth";
import { healthMonitor } from "./utils/healthMonitor";

const app = express();
const port = process.env.PORT || 3004;

app.use(cors());
app.use(bodyParser.json());

app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    logError("RewardsPollerService", error, { operation: "request" });

    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.get("/health", async (_, res) => {
  const errorFileExists = await healthMonitor.errorFileExists();
  res.status(errorFileExists ? 500 : 200).json({status: !errorFileExists, message: 'pong'})
});

app.listen(port, async () => {
  try {
    logInfo("RewardsPollerService", "Starting rewards poller service...");

    await initOpenIdConfig();

    await initializeRewardsPolling();

    logInfo(
      "RewardsPollerService",
      `Rewards poller service started successfully on port ${port}`,
    );
  } catch (error) {
    logError("RewardsPollerService", error as Error, { operation: "startup" });
    process.exit(1);
  }
});

