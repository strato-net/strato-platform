const models = require("../models");
const winston = require("winston-color");


async function getLatestHealth() {
  const [healthInfo, stallInfo, systemInfo, syncInfo, networkInfo, jsonRpcInfo] = await Promise.all([
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
    }),

    // Written by the node-health-check daemon; null until its first poll.
    models.CurrentHealth.findOne({
      where: {
        processName: "JsonRpcStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),
  ]);
  
  return [healthInfo, stallInfo, systemInfo, syncInfo, networkInfo, jsonRpcInfo];
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

// jsonRpcInfo is the "JsonRpcStat" row (may be null before the daemon's first
// poll, or on compose files that never enabled the check). Only a row marked
// enabled can make the node unhealthy.
function consolidateHealthData(healthInfo, stallInfo, systemInfo, syncInfo, jsonRpcInfo = null) {
  const currentTime = Date.now();
  const jsonRpcDetails = jsonRpcInfo ? parseJson(jsonRpcInfo.additionalInfo) : {};
  const jsonRpcEnabled = jsonRpcDetails.enabled === true;
  const jsonRpcHealth = jsonRpcEnabled ? !!jsonRpcInfo.latestHealthStatus : true;
  const healthStatHealth = healthInfo.latestHealthStatus;
  const stallStatHealth = stallInfo.latestHealthStatus;
  const systemStatHealth = systemInfo.latestHealthStatus;
  const nodeHealthWarnings = healthInfo.additionalInfo;
  const isSynced = syncInfo.latestHealthStatus;
  const isSyncStalled = JSON.parse(syncInfo.additionalInfo)?.isStalled;
  const systemWarnings = JSON.parse(systemInfo.additionalInfo).Alerts;

  const health = healthStatHealth && stallStatHealth && !isSyncStalled && jsonRpcHealth;
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

  if (jsonRpcEnabled && !jsonRpcHealth) {
    healthIssues.push(
      `JSON-RPC service (ethereum-jsonrpc) is down. Reason: ${jsonRpcDetails.error || "no response"}`
    );
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
      jsonRpc: {
        enabled: jsonRpcInfo ? jsonRpcEnabled : null,
        health: jsonRpcInfo ? jsonRpcHealth : null,
        url: jsonRpcDetails.url || null,
        blockNumber: jsonRpcDetails.blockNumber ?? null,
        error: jsonRpcDetails.error || null,
        consecutiveFailures: jsonRpcDetails.consecutiveFailures ?? null,
        latestCheckTimestamp: jsonRpcInfo ? jsonRpcInfo.latestCheckTimestamp : null,
        lastFailureTimestamp: jsonRpcInfo ? jsonRpcInfo.lastFailureTimestamp : null,
      },
    },
  };
}

module.exports = {
  getLatestHealth,
  consolidateHealthData,
};
