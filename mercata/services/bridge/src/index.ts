import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { logInfo, logError } from "./utils/logger";
import { validateBridgeConfig } from "./utils/configValidator";
import { startMultiChainDepositPolling } from "./polling/alchemyPolling";
import { initializeMercataPolling } from "./polling/mercataPolling";
import { initOpenIdConfig, verifyAccessTokenSignature, getTokenFromHeader, createOrGetUserKey } from "./auth";
import { healthMonitor } from "./utils/healthMonitor";
import { requestAutoSave } from "./services/autosaveService";

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

app.get("/health", async (_, res) => {
  const errorFileExists = await healthMonitor.errorFileExists();
  res.status(errorFileExists ? 500 : 200).json({status: !errorFileExists, message: 'pong'})
});

app.post("/requestAutoSave", async (req, res, next) => {
  try {
    // Extract and validate token
    const token = getTokenFromHeader(req);
    if (!token) {
      return res.status(401).json({ error: "Missing or invalid authorization header" });
    }

    // Verify token signature
    try {
      await verifyAccessTokenSignature(token);
    } catch (error: any) {
      return res.status(401).json({
        error: "Invalid or expired access token",
        message: error.message
      });
    }

    // Get user address from token
    let userAddress: string;
    try {
      userAddress = await createOrGetUserKey(token);
    } catch (error: any) {
      return res.status(401).json({
        error: "Failed to get user address",
        message: error.message
      });
    }

    // Extract request parameters
    const { externalChainId, externalTxHash } = req.body;
    if (!externalChainId || !externalTxHash) {
      return res.status(400).json({
        error: "Missing required parameters: externalChainId and externalTxHash"
      });
    }

    // Call the service
    const result = await requestAutoSave({ userAddress, externalChainId, externalTxHash });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
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
    await initializeMercataPolling();

    logInfo(
      "BridgeService",
      `Bridge service started successfully on port ${port}`,
    );
  } catch (error) {
    logError("BridgeService", error as Error, { operation: "startup" });
    process.exit(1);
  }
});
