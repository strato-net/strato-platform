import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { config } from "./config";
import { bootstrapDb } from "./db/bootstrap";
import { router } from "./api/routes";
import { runCirrusPoller } from "./indexer/cirrus";
import { logError, logInfo } from "./utils/logger";

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use("/partner-api", router);

app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("PartnerReferrals", error, { operation: "request", method: req.method, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
});

// The database (and its migrations) comes first: the socket only opens once
// the schema is in place.
(async () => {
  try {
    await bootstrapDb();
  } catch (error) {
    logError("PartnerReferrals", error, { operation: "bootstrapDb" });
    process.exit(1);
  }
  app.listen(config.port, () => {
    logInfo("PartnerReferrals", `Listening on port ${config.port}`);
    if (config.cirrus.nodeUrl) {
      runCirrusPoller().catch((error) => logError("PartnerReferrals", error, { operation: "cirrus" }));
    } else {
      logInfo("PartnerReferrals", "Cirrus poller disabled");
    }
  });
})();
