const models = require("../models");
const winston = require("winston-color");


async function getLatestHealth() {
  const [healthInfo, stallInfo, systemInfo, syncInfo, networkInfo] = await Promise.all([
    models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),
    
    models.CurrentHealth.findOne({
      where: {
        processName: "StallStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "validBlocksIncreased",
        "hasPendingTxs",
      ],
      raw: true,
    }),
    
    models.CurrentHealth.findOne({
      where: {
        processName: "SystemInfoStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),
    
    models.CurrentHealth.findOne({
      where: {
        processName: "SyncStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),
    
    models.CurrentHealth.findOne({
      where: {
        processName: "NetworkHealthStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    })
  ]);
  
  return [healthInfo, stallInfo, systemInfo, syncInfo, networkInfo];
}

function consolidateHealthData(healthInfo, stallInfo, systemInfo, syncInfo) {
  const currentTime = Date.now();
  const healthStatHealth = healthInfo.latestHealthStatus;
  const stallStatHealth = stallInfo.latestHealthStatus;
  const systemStatHealth = systemInfo.latestHealthStatus;
  const nodeHealthWarnings = healthInfo.additionalInfo;
  const isSynced = syncInfo.latestHealthStatus;
  const isSyncStalled = JSON.parse(syncInfo.additionalInfo)?.isStalled;
  const systemWarnings = JSON.parse(systemInfo.additionalInfo).Alerts;

  const health = healthStatHealth && stallStatHealth && !isSyncStalled;
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
      `Node is unhealthy. Reasons: ${nodeHealthWarnings || "Reason currently unknown."}`
    );
  }

  if (!stallStatHealth) {
    healthIssues.push(`Node has stalled.`);
  }

  if (isSyncStalled) {
    healthIssues.push(`Node's sync has stalled.`);
  }

  if (!systemStatHealth) {
    healthIssues.push(`Node's host is unhealthy. Reasons: ${systemWarnings || "Reason currently unknown."}`);
  }

  return {
    health,
    healthStatus,
    healthIssues,
    uptime: healthStatHealth
      ? (currentTime - healthInfo.lastFailureTimestamp) / 1000
      : 0,
    healthData: {
      healthChecks: {
        health: healthStatHealth,
        latestCheckTimestamp: healthInfo.latestCheckTimestamp,
        lastFailureTimestamp: healthInfo.lastFailureTimestamp,
      },
      nodeSync: {
        isSynced,
        isSyncStalled,
        latestCheckTimestamp: syncInfo.latestCheckTimestamp,
        lastFailureTimestamp: syncInfo.lastFailureTimestamp,
      },
      stallHealth: {
        health: stallStatHealth,
        validBlocksIncreased: stallInfo.validBlocksIncreased,
        hasPendingTxs: stallInfo.hasPendingTxs,
        latestCheckTimestamp: stallInfo.latestCheckTimestamp,
        lastFailureTimestamp: stallInfo.lastFailureTimestamp,
      },
      systemHealth: {
        health: systemStatHealth,
        systemInfo: JSON.parse(systemInfo.additionalInfo),
        warnings: systemWarnings,
        latestCheckTimestamp: systemInfo.latestCheckTimestamp,
        lastFailureTimestamp: systemInfo.lastFailureTimestamp,
      },
    },
  };
}

module.exports = {
  getLatestHealth,
  consolidateHealthData,
};
