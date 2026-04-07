import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { logInfo, logError } from "./utils/logger";
import { validateReferralConfig } from "./utils/configValidator";
import { initOpenIdConfig} from "./auth";
import { healthMonitor } from "./utils/healthMonitor";
import ReferralController from "./controllers/referral.controller";
import AuthHandler from "./auth/tokenMiddleware";

const app = express();
const port = process.env.PORT || 3003;

app.use(cors());
app.use(bodyParser.json());

// Global error handler
app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    logError("ReferralService", error, { operation: "request" });

    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Exposed Routes
app.get("/health", async (_, res) => {
  const errorFileExists = await healthMonitor.errorFileExists();
  res.status(errorFileExists ? 500 : 200).json({status: !errorFileExists, message: 'pong'})
});
app.post("/redeem-referral", AuthHandler.authorizeRequest(), ReferralController.redeemReferral);

app.listen(port, async () => {
  try {
    logInfo("ReferralService", "Starting referral redemption service...");

    // Validate configuration before starting
    const configValid = await validateReferralConfig();
    if (!configValid) {
      const error = new Error(
        "Configuration validation failed - service cannot start",
      );
      logError("ReferralService", error);
      process.exit(1);
    }

    // Initialize OAuth
    await initOpenIdConfig();

    logInfo(
      "ReferralService",
      `Referral redemption service started successfully on port ${port}`,
    );
  } catch (error) {
    logError("ReferralService", error as Error, { operation: "startup" });
    process.exit(1);
  }
});
