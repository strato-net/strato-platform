import dotenv from "dotenv";
dotenv.config();

import bodyParser from "body-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import {
  WithdrawalAuditRouteType,
  WithdrawalAuditStatusGroup,
} from "@mercata/shared-types";
import { createWithdrawalAuditCache } from "./auditCache";
import { createWithdrawalAuditService } from "./auditService";
import { createAccessTokenProvider } from "./auth";
import { createCirrusClient } from "./cirrusClient";
import { loadConfig } from "./config";
import { logError, logInfo } from "./logger";
import { createWithdrawalAuditPoller } from "./poller";
import { createProvenanceEngine } from "./provenanceEngine";
import { HealthResponse } from "./types";
import { createWithdrawalRepository } from "./withdrawalRepository";

const app = express();
const config = loadConfig();
const cirrusClient = createCirrusClient(config, createAccessTokenProvider(config));
const cache = createWithdrawalAuditCache();
const repository = createWithdrawalRepository(cirrusClient, config);
const provenanceEngine = createProvenanceEngine(repository);
const auditService = createWithdrawalAuditService(
  config,
  cache,
  repository,
  provenanceEngine,
);
const poller = createWithdrawalAuditPoller(config, auditService);

const asyncHandler =
  (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  ) =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };

const parseLimit = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 10;
};

const parseMaxDepth = (value: unknown): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseStatusGroup = (value: unknown): WithdrawalAuditStatusGroup => {
  if (
    value === "initiated" ||
    value === "pending-review" ||
    value === "complete" ||
    value === "aborted"
  ) {
    return value;
  }
  return "initiated";
};

const parseRouteType = (value: string): WithdrawalAuditRouteType => {
  if (value === "standard" || value === "native") return value;
  throw new Error("Invalid route type");
};

app.use(cors());
app.use(bodyParser.json());

app.get("/health", (_, res: Response<HealthResponse>) => {
  res.json({
    status: "ok",
    service: "withdrawal-auditing-service",
  });
});

app.get(
  "/audits/withdrawals/recent",
  asyncHandler(async (req, res) => {
    const result = await auditService.getRecentAudits(
      parseLimit(req.query.limit),
      parseMaxDepth(req.query.maxDepth),
      parseStatusGroup(req.query.statusGroup),
    );
    res.json(result);
  }),
);

app.get(
  "/audits/withdrawals/:routeType/:withdrawalId",
  asyncHandler(async (req, res) => {
    const result = await auditService.getAudit(
      parseRouteType(req.params.routeType),
      req.params.withdrawalId,
      parseMaxDepth(req.query.maxDepth),
    );

    if (!result) {
      res.status(404).json({ error: "Audit not ready" });
      return;
    }

    res.json(result);
  }),
);

app.post(
  "/audits/withdrawals/warm",
  asyncHandler(async (req, res) => {
    void auditService
      .warmAuditCache({
        limit: parseLimit(req.body?.limit),
        maxDepth: parseMaxDepth(req.body?.maxDepth),
      })
      .catch((error) =>
        logError("HTTP", error as Error, { operation: "manualWarm" }),
      );

    res.json({ started: true });
  }),
);

app.use(
  (
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    logError("HTTP", error, { operation: "request" });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

const server = app.listen(config.port, async () => {
  try {
    logInfo("Startup", "Withdrawal Auditing Service starting", {
      port: config.port,
      pollIntervalMs: config.pollIntervalMs,
    });
    await cirrusClient.verifyConnectivity();
    logInfo("Startup", "Cirrus connectivity verified");
    void auditService.warmAuditCache().catch((error) =>
      logError("Startup", error as Error, { operation: "startupWarm" }),
    );
    poller.start();
    logInfo("Startup", "Withdrawal Auditing Service started");
  } catch (error) {
    logError("Startup", error as Error, { operation: "startup" });
    process.exit(1);
  }
});

const shutdown = () => {
  poller.stop();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
