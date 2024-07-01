const winston = require("winston-color");
const models = require("../models");
const Promise = require("bluebird");
const rp = require("request-promise");
const moment = require("moment");

const config = require("../config/app.config");
let MONITOR_URL = `${process.env["MONITOR_URL"]}`;

async function singleCheck() {
  try {
    if (!MONITOR_URL) {
      MONITOR_URL = await getMonitorUrl();
    }
    //in the event monitor url is not returned via the metadata endpoint
    if (MONITOR_URL) {
      await queryNetworkHealthStatus();
    } else {
      updateNetworkHealthStatus(
        {
          healthPublicInfo: {
            latestHealthStatus: false,
          }
        },
        "UNKNOWN"
      );
    }

    winston.info("Network health status queried at " + moment().format());
  } catch (err) {
    winston.error("Network health status error: " + err.message);
    updateNetworkHealthStatus(
      {
        healthPublicInfo: {
          latestHealthStatus: false,
        }
      },
      "UNKNOWN"
    );
  }
}

function queryNetworkHealthStatus() {
  return new Promise(async (resolve, _void) => {
    try {
      winston.info(
        `Retrieving network health from Monitor Host: ${MONITOR_URL}`
      );
      const status = await getNetworkStatus();
      winston.debug(
        `Network is ${!status.healthPublicInfo.latestHealthStatus ? "unhealthy" : "healthy"}`
      );
      winston.info("Updating network health");
      await updateNetworkHealthStatus(
        status,
        `${!status.healthPublicInfo.latestHealthStatus ? "UNHEALTHY" : "HEALTHY"}`
      );
      winston.info("Network health updated");
      return resolve();
    } catch (error) {
      winston.error(
        `Error occurred while querying network health: "${
          error.message ? error.message : "no message"
        }"`
      );
      return resolve();
    }
  }).timeout(config.networkHealthCheck.requestTimeout - 80);
}

async function updateNetworkHealthStatus(status, statusMessage) {
  let currentTime = Date.now();
  let [stat, created] = await models.CurrentHealth.findOrCreate({
    where: { processName: "NetworkHealthStat" },
    defaults: {
      latestHealthStatus: status.healthPublicInfo.latestHealthStatus,
      latestCheckTimestamp: currentTime,
      lastFailureTimestamp: currentTime, //default first time marked as failure
      additionalInfo: JSON.stringify({ ...status, statusMessage }),
    },
  });
  if (!created) {
    await stat.update(
      {
        latestCheckTimestamp: currentTime,
        latestHealthStatus: status.healthPublicInfo.latestHealthStatus,
        lastFailureTimestamp: status.healthPublicInfo.latestHealthStatus
          ? stat.lastFailureTimestamp
          : currentTime,
        additionalInfo: JSON.stringify({ ...status, statusMessage }),
      },
      {
        where: { processName: "NetworkHealthStat" },
      }
    );
  }

  return;
}

async function getMonitorUrl() {
  const options = {
    method: "GET",
    url: `http://${process.env['STRATO_HOSTNAME']}:${process.env['STRATO_PORT_API']}/eth/v1.2/metadata`,
    followRedirects: false,
    timeout: config.healthCheck.requestTimeout - 100,
    json: true,
  };

  const resp = await rp(options);
  return resp.urls.monitor;
}

async function getNetworkStatus() {
  if (!MONITOR_URL) {
    throw Error("MONITOR_URL is not set.");
  }
  const options = {
    method: "GET",
    url: `${MONITOR_URL}/health`,
    followRedirects: false,
    timeout: config.networkHealthCheck.requestTimeout - 100,
    json: true,
  };
  return rp(options);
}

module.exports = {
  singleCheck,
};
