import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { logInfo, logError } from "./utils/logger";
import { validateBridgeConfig } from "./utils/configValidator";
import {
  reconcileExternalDeposits,
  startMultiChainDepositPolling,
} from "./polling/alchemyPolling";
import { startNativeRedemptionPolling } from "./polling/nativeRedemptionPolling";
import { initializeStratoPolling } from "./polling/stratoPolling";
import { initOpenIdConfig} from "./auth";
import { healthMonitor } from "./utils/healthMonitor";
import { depositMetricsService } from "./services/depositMetricsService";
import { confirmReviewedDeposit } from "./services/bridgeService";
import { depositStateService } from "./services/depositStateService";
import { getDepositStatusByIdentity } from "./services/cirrusService";

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

app.get("/metrics/deposits", (_, res) => {
  res.json(depositMetricsService.snapshot());
});

app.post("/webhooks/deposits/:chainId", async (req, res) => {
  const webhookToken = process.env.DEPOSIT_WEBHOOK_TOKEN;
  const tokenRequired = !["development", "test"].includes(
    process.env.NODE_ENV || "",
  );
  if (tokenRequired && !webhookToken) {
    res.status(503).json({ error: "Webhook authentication is not configured" });
    return;
  }
  if (
    webhookToken &&
    req.headers.authorization !== `Bearer ${webhookToken}`
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const chainId = Number(req.params.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    res.status(400).json({ error: "Invalid chain ID" });
    return;
  }
  try {
    await reconcileExternalDeposits(chainId);
    res.status(202).json({ accepted: true });
  } catch (error) {
    logError("DepositWebhook", error as Error, { chainId });
    res.status(503).json({ error: "Reconciliation failed" });
  }
});

app.post(
  "/operations/deposits/:chainId/:depositRouter/:depositId/confirm",
  async (req, res) => {
    const token = process.env.DEPOSIT_OPERATIONS_TOKEN;
    if (!token) {
      res.status(503).json({ error: "Deposit operations are not configured" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const chainId = Number(req.params.chainId);
    const depositId = req.params.depositId;
    const depositRouter = req.params.depositRouter.replace(/^0x/i, "");
    if (
      !Number.isSafeInteger(chainId) ||
      chainId <= 0 ||
      !/^[1-9][0-9]*$/.test(depositId) ||
      !/^[0-9a-fA-F]{40}$/.test(depositRouter)
    ) {
      res.status(400).json({ error: "Invalid deposit identity" });
      return;
    }
    try {
      const transactionHash = await confirmReviewedDeposit(
        chainId,
        depositRouter,
        depositId,
      );
      try {
        await depositStateService.markSettledByIdentity(
          chainId,
          depositRouter,
          depositId,
        );
      } catch (error) {
        logError("DepositOperations", error as Error, {
          operation: "markReviewedDepositSettled",
          chainId,
          depositRouter,
          depositId,
        });
      }
      res.status(200).json({ transactionHash });
    } catch (error) {
      logError("DepositOperations", error as Error, {
        chainId,
        depositRouter,
        depositId,
      });
      res.status(503).json({ error: "Deposit confirmation failed" });
    }
  },
);

app.post(
  "/operations/deposits/:chainId/:depositRouter/:depositId/reset",
  async (req, res) => {
    const token = process.env.DEPOSIT_OPERATIONS_TOKEN;
    if (!token) {
      res.status(503).json({ error: "Deposit operations are not configured" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const chainId = Number(req.params.chainId);
    const depositId = req.params.depositId;
    const depositRouter = req.params.depositRouter.replace(/^0x/i, "");
    if (
      !Number.isSafeInteger(chainId) ||
      chainId <= 0 ||
      !/^[1-9][0-9]*$/.test(depositId) ||
      !/^[0-9a-fA-F]{40}$/.test(depositRouter)
    ) {
      res.status(400).json({ error: "Invalid deposit identity" });
      return;
    }
    const onchainStatus = await getDepositStatusByIdentity(
      chainId,
      depositRouter,
      depositId,
    );
    if (onchainStatus !== undefined && onchainStatus !== "7") {
      res.status(409).json({
        error: `Deposit must be absent or aborted before reset (status ${onchainStatus})`,
      });
      return;
    }
    await depositStateService.resetForRetryByIdentity(
      chainId,
      depositRouter,
      depositId,
    );
    res.status(202).json({ reset: true });
  },
);

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

    logInfo(
      "BridgeService",
      `Bridge service started successfully on port ${port}`,
    );
  } catch (error) {
    logError("BridgeService", error as Error, { operation: "startup" });
    process.exit(1);
  }
});
