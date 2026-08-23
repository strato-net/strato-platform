import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { logInfo, logError } from "./utils/logger";
import { validateBridgeConfig } from "./utils/configValidator";
import { startMultiChainDepositPolling } from "./polling/alchemyPolling";
import { startNativeRedemptionPolling } from "./polling/nativeRedemptionPolling";
import { initializeStratoPolling } from "./polling/stratoPolling";
import { startAnchorPolling } from "./polling/anchorPolling";
import { initOpenIdConfig} from "./auth";
import { healthMonitor } from "./utils/healthMonitor";

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
    logError("BridgeService", error, { operation: "request" });

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

app.listen(port, async () => {
  try {
    logInfo("BridgeService", "Starting bridge service...");

    // Validate configuration before starting
    const configValid = await validateBridgeConfig();
    if (!configValid) {
      const error = new Error(
        "Configuration validation failed - service cannot start",
      );
      logError("BridgeService", error);
      process.exit(1);
    }

    // Initialize OAuth
    await initOpenIdConfig();

    // Start polling services
    startMultiChainDepositPolling();
    startNativeRedemptionPolling();
    await initializeStratoPolling();
    // Anchors deposit blocks ahead of anyone claiming them, so a claim is
    // one transaction instead of an anchor batch. No-ops without PROVER_URL.
    startAnchorPolling();

    logInfo(
      "BridgeService",
      `Bridge service started successfully on port ${port}`,
    );
  } catch (error) {
    logError("BridgeService", error as Error, { operation: "startup" });
    process.exit(1);
  }
});
