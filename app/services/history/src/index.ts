import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { config } from "./config";
import { bootstrapDb } from "./db/bootstrap";
import { pool } from "./db/pool";
import { router } from "./api/routes";
import { runBusConsumerForever } from "./indexer/bus";
import { runCirrusPoller } from "./indexer/cirrus";
import { logError, logInfo } from "./utils/logger";

// Every timestamp arithmetic in SQL (day buckets, snapshots) is in UTC.
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((error) => logError("DB", error, { operation: "set timezone" }));
});

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use("/history-api", router);

app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("HistoryService", error, { operation: "request", method: req.method, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, async () => {
  logInfo("HistoryService", `Listening on port ${config.port}`);
  try {
    await bootstrapDb();
  } catch (error) {
    logError("HistoryService", error, { operation: "bootstrapDb" });
    process.exit(1);
  }
  // The two feeds run side by side and write through one serialised apply
  // step. The bus is the low-latency path; the poller is the backfill from
  // genesis and the completeness guarantee behind it.
  if (config.bus.host) {
    runBusConsumerForever().catch((error) => logError("HistoryService", error, { operation: "bus" }));
  } else {
    logInfo("HistoryService", "BUS_HOST not set: live feed disabled");
  }
  if (config.cirrus.enabled && config.cirrus.nodeUrl) {
    runCirrusPoller().catch((error) => logError("HistoryService", error, { operation: "cirrus" }));
  } else {
    logInfo("HistoryService", "Cirrus poller disabled");
  }
});
