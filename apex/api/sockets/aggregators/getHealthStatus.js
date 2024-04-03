const {
  GET_HEALTH,
  GET_NODE_UPTIME,
  GET_SYSTEM_INFO,
  GET_NETWORK_HEALTH,
} = require("../rooms");
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require("../eventBroker");
const rp = require("request-promise");
const models = require("../../models");
const config = require("../../config/app.config");
const { Prometheus } = require("../../lib/promClient");
const utils = require("../../lib/utils");
const health = require("../../controllers/health");

let healthBody = {
  healthStatus: null,
  healthIssues: null,
  uptime: 0,
  healthData: {
    healthChecks: {
      health: null,
      latestCheckTimestamp: null,
      lastFailureTimestamp: null,
    },
    nodeSync: {
      isSynced: null,
      isSyncStalled: null,
      latestCheckTimestamp: null,
      lastFailureTimestamp: null,
    },
    stallHealth: {
      health: null,
      validBlocksIncreased: null,
      hasPendingTxs: null,
      latestCheckTimestamp: null,
      lastFailureTimestamp: null,
    },
    systemHealth: {
      health: null,
      systemInfo: null,
      warnings: null,
      latestCheckTimestamp: null,
      lastFailureTimestamp: null,
    },
  },
};

let networkHealthInfo = {
  latestHealthStatus: false,
  additionalInfo: JSON.stringify({
    needsAttention: true,
    statusMessage: "UNKNOWN",
  }),
};

const counter = new Prometheus.Counter({
  name: "health_status_counter",
  help: "health_status_counter",
});

async function getHealthStatus() {
  counter.inc();
  const healthInfoPromise = models.CurrentHealth.findOne({
    where: {
      processName: "HealthStat",
    },
    attributes: [
      "latestHealthStatus",
      "latestCheckTimestamp",
      "lastFailureTimestamp",
    ],
  });
  const stallInfoPromise = models.CurrentHealth.findOne({
    where: {
      processName: "StallStat",
    },
    attributes: [
      "latestHealthStatus",
      "latestCheckTimestamp",
      "lastFailureTimestamp",
    ],
  });

  const systemInfoPromise = models.CurrentHealth.findOne({
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
  });

  const syncInfoPromise = models.CurrentHealth.findOne({
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
  });

  const networkHealthPromise = models.CurrentHealth.findOne({
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
  });

  const [healthInfo, stallInfo, systemInfo, syncInfo, networkHealthInfo] =
    await Promise.all([
      healthInfoPromise,
      stallInfoPromise,
      systemInfoPromise,
      syncInfoPromise,
      networkHealthPromise,
    ]);

  if (healthInfo && stallInfo && systemInfo && syncInfo) {
    healthBody = utils.consolidateHealthData(
      healthInfo,
      stallInfo,
      systemInfo,
      syncInfo
    );

    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_HEALTH, {
      health: healthBody.health,
      healthStatus: healthBody.healthStatus,
      healthIssues: healthBody.healthIssues,
    });

    emitter.emit(
      ON_SOCKET_PUBLISH_EVENTS,
      GET_NODE_UPTIME,
      healthBody.uptime
    );
    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_SYSTEM_INFO, {
      status: healthBody.healthData.systemHealth.health,
      warnings: healthBody.healthData.systemHealth.warnings,
      systemInfo: healthBody.healthData.systemHealth.systemInfo,
    });
  }

  if (networkHealthInfo) {
    emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_NETWORK_HEALTH, {
      status: networkHealthInfo.latestHealthStatus,
      statusMessage: JSON.parse(networkHealthInfo.additionalInfo).statusMessage,
    });
  }
}

getHealthStatus();
setInterval(getHealthStatus, config.webSockets.dbPollFrequency);

function initialHydrateHealthStatus(socket) {
  socket.emit(`PRELOAD_${GET_HEALTH}`, {
    health: healthBody.health,
    healthStatus: healthBody.status,
    healthIssues: healthBody.healthIssue,
  });
}

function initialHydrateUptime(socket) {
  socket.emit(`PRELOAD_${GET_NODE_UPTIME}`, healthBody.uptime);
}

function initialHydrateSystemInfo(socket) {
  socket.emit(`PRELOAD_${GET_SYSTEM_INFO}`, {
    status: healthBody.healthData.systemHealth.health,
    warnings: healthBody.healthData.systemHealth.warnings,
    systemInfo: healthBody.healthData.systemHealth.systemInfo,
  });
}

function initialHydrateNetworkHealthInfo(socket) {
  socket.emit(`PRELOAD_${GET_NETWORK_HEALTH}`, {
    status: networkHealthInfo.latestHealthStatus,
    statusMessage: JSON.parse(networkHealthInfo.additionalInfo).statusMessage,
  });
}

module.exports = {
  initialHydrateHealthStatus,
  initialHydrateUptime,
  initialHydrateSystemInfo,
  initialHydrateNetworkHealthInfo,
};
