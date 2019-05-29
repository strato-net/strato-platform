const {GET_HEALTH, GET_NODE_UPTIME, GET_SYSTEM_INFO} = require('../rooms');
const {emitter, ON_SOCKET_PUBLISH_EVENTS} = require('../eventBroker');
const rp = require('request-promise');
const models = require('../../models');
const config = require('../../config/app.config');

let healthStatus, uptimeDur, systemInfoStatus, systemInfoMessages;


async function getHealthStatus() {
  const healthInfo = await models.CurrentHealth.findOne({
    where: {
      processName: "HealthStat"
    },
    attributes: [
      'latestHealthStatus',
      'latestCheckTimestamp',
      'lastFailureTimestamp'
    ]
  })
  const stallInfo = await models.CurrentHealth.findOne({
    where: {
      processName: "StallStat"
    },
    attributes: [
      'latestHealthStatus',
      'latestCheckTimestamp',
      'lastFailureTimestamp'
    ]
  })

  const systemInfo = await models.CurrentHealth.findOne({
    where: {
      processName: "SystemInfoStat"
    },
    attributes: [
      'latestHealthStatus',
      'latestCheckTimestamp',
      'lastFailureTimestamp',
      'isBlocksValidInc',
      'isLastPending',
      'additionalInfo'
    ],
    raw: true,
  }).catch(err => next(err));

  let currentTime = Date.now();

  if (healthInfo && stallInfo) {
    healthStatus = healthInfo.dataValues.latestHealthStatus && stallInfo.dataValues.latestHealthStatus;
    uptimeDur = (healthStatus) ? currentTime - healthInfo.dataValues.lastFailureTimestamp : 0;
  }

  if (systemInfo) {
    systemInfoStatus = systemInfo.latestHealthStatus;
    systemInfoMessages = systemInfoStatus ? "" : systemInfo.additionalInfo.split('"Alerts":')[1].split('}')[0];
  }
  emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_HEALTH, healthStatus);
  emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_NODE_UPTIME, uptimeDur / 1000);
  emitter.emit(ON_SOCKET_PUBLISH_EVENTS, GET_SYSTEM_INFO, {status: systemInfoStatus, warnings: systemInfoMessages})
}

getHealthStatus()
setInterval(getHealthStatus, config.webSockets.dbPollFrequency);

function initialHydrateHealthStatus(socket) {
  socket.emit(`PRELOAD_${GET_HEALTH}`, healthStatus);
}

function initialHydrateUptime(socket) {
  socket.emit(`PRELOAD_${GET_NODE_UPTIME}`, uptimeDur / 1000);
}

function initialHydrateSystemInfo(socket) {
  socket.emit(`PRELOAD_${GET_SYSTEM_INFO}`, {status: systemInfoStatus, warnings: systemInfoMessages});
}

module.exports = {
  initialHydrateHealthStatus,
  initialHydrateUptime,
  initialHydrateSystemInfo
}

