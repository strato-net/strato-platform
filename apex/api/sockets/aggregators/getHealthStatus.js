const {
  GET_HEALTH,
  GET_NODE_UPTIME,
  GET_SYSTEM_INFO,
  GET_NETWORK_HEALTH,
} = require("../rooms");
const { emitter, ON_SOCKET_PUBLISH_EVENTS } = require("../eventBroker");
const models = require("../../models");
const config = require("../../config/app.config");
const { Prometheus } = require("../../lib/promClient");
const utils = require("../../lib/utils");

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

  const [healthInfo, stallInfo, systemInfo, syncInfo, networkHealthInfo] = await utils.getLatestHealth()

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
