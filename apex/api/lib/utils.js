const models = require("../models");
const winston = require("winston-color");
const config = "../config/app.config";

function consolidateHealthData(healthInfo, stallInfo, systemInfo, syncInfo) {
  const currentTime = Date.now();
  const healthStatHealth = healthInfo.latestHealthStatus;
  const stallStatHealth = stallInfo.latestHealthStatus;
  const systemStatHealth = systemInfo.latestHealthStatus;
  const isSynced = syncInfo.latestHealthStatus;
  const isSyncStalled = JSON.parse(syncInfo.additionalInfo)?.isStalled;
  const systemWarnings = JSON.parse(systemInfo.additionalInfo).Alerts;

  const health =
    healthStatHealth && stallStatHealth && !isSyncStalled && systemStatHealth;
  const healthStatus = isSyncStalled
    ? "SYNC STALLED"
    : !health
    ? "UNHEALTHY"
    : !isSynced
    ? "SYNCING"
    : "HEALTHY";

  const healthIssues = [];

  if (!healthStatHealth) {
    healthIssues.push(
      `Node is unhealthy. ${systemWarnings || "Reason currently unknown."}`
    );
  }

  if (!stallStatHealth) {
    healthIssues.push(`Node has stalled.`);
  }

  if (isSyncStalled) {
    healthIssues.push(`Node's sync has stalled.`);
  }

  if (!systemStatHealth) {
    healthIssues.push(`Node's host is unhealthy. ${systemWarnings}`);
  }

  return {
    health,
    healthStatus,
    healthIssues,
    healthData: {
      healthChecks: {
        health: healthStatHealth,
        uptime: healthStatHealth
          ? currentTime - healthInfo.lastFailureTimestamp
          : 0,
        latestCheckTimestamp: healthInfo.latestCheckTimestamp,
        lastFailureTimestamp: healthInfo.lastFailureTimestamp,
      },
      nodeSync: {
        isSynced,
        isSyncStalled,
        latestCheckTimestamp: syncInfo.latestCheckTimestamp,
        lastFailureTimestamp: syncInfo.lastFailureTimestamp,
      },
      systemHealth: {
        health: systemStatHealth,
        systemInfo: JSON.parse(systemInfo.additionalInfo),
        warnings: systemWarnings,
        stats: JSON.parse(systemInfo.additionalInfo),
        latestCheckTimestamp: systemInfo.latestCheckTimestamp,
        lastFailureTimestamp: systemInfo.lastFailureTimestamp,
      },
      stallHealth: {
        health: stallStatHealth,
        validBlocksIncreased: stallInfo.validBlocksIncreased,
        hasPendingTxs: stallInfo.hasPendingTxs,
        latestCheckTimestamp: stallInfo.latestCheckTimestamp,
        lastFailureTimestamp: stallInfo.lastFailureTimestamp,
      },
    },
  };
}

module.exports = {
  consolidateHealthData,
};
