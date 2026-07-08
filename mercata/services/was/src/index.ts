import dotenv from "dotenv";
dotenv.config();

import { createWithdrawalAuditCache } from "./auditCache";
import { createWithdrawalAuditService } from "./auditService";
import { createAccessTokenProvider } from "./auth";
import { createCirrusClient } from "./cirrusClient";
import { loadConfig } from "./config";
import { clearVolatileDebugOutputs } from "./debugCleanup";
import { createWasApp } from "./http";
import { createSnapshotBackedCirrusClient } from "./localEventStore";
import { logError, logInfo } from "./logger";
import { createWithdrawalAuditPoller } from "./poller";
import { createProvenanceEngine } from "./provenanceEngine";
import { createWithdrawalRepository } from "./withdrawalRepository";

const config = loadConfig();
const cirrusClient = createSnapshotBackedCirrusClient(
  createCirrusClient(config, createAccessTokenProvider(config)),
  config,
);
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
const app = createWasApp(auditService);

const server = app.listen(config.port, async () => {
  try {
    logInfo("Startup", "Withdrawal Auditing Service starting", {
      port: config.port,
      pollIntervalMs: config.pollIntervalMs,
    });
    clearVolatileDebugOutputs(config);
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
