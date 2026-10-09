import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { config } from "./config";
import { bootstrapDb } from "./db/bootstrap";
import { pool } from "./db/pool";
import { router } from "./api/routes";
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

// The database (and its migrations) comes first: the socket only opens once
// the schema is in place, so a load balancer's health check cannot route
// requests here while migrations run, and a failed migration exits before
// anything was served.
(async () => {
  try {
    await bootstrapDb();
  } catch (error) {
    logError("HistoryService", error, { operation: "bootstrapDb" });
    process.exit(1);
  }
  app.listen(config.port, () => {
    logInfo("HistoryService", `Listening on port ${config.port}`);
    // The Cirrus poller is the feed: the backfill from genesis on first
    // start, then one page per interval.
    if (config.cirrus.enabled && config.cirrus.nodeUrl) {
      runCirrusPoller().catch((error) => logError("HistoryService", error, { operation: "cirrus" }));
    } else {
      logInfo("HistoryService", "Cirrus poller disabled");
    }
  });
})();
