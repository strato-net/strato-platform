const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const moment = require('moment');
const si = require('systeminformation');
const disk = require('diskusage');
const config = require('../config/app.config');

// TODO: do the mass-refactoring of the daemon. Use the OOP! Really, don't even try refactoring this without the main Object (SingleCheck object with methods and shared params). Don't change any db data formats.

const neededJobs = {
  "slipstream_main": "slipstream",
  "strato_p2p": "strato-p2p",
  "vm_main": "vm-runner",
  "seq_main": "strato-sequencer",
  "blockapps-vault-wrapper-server": "vault-wrapper",
  "blockapps-bloc": "bloc",
  "strato-api": "strato-api"
}

const isOauthEnabled = (process.env['OAUTH_ENABLED'] === config.oAuthEnabledTrueValue);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// DAEMON - query node-health-check every N sec
winston.info('Starting node-health-check with a delay of', config.healthCheck.pollFrequency);

(async () => {
  await singleCheck()
  setInterval(async () => {
    await singleCheck()
  }, config.healthCheck.pollFrequency);
})();

async function singleCheck() {
  try {
    await queryHealthStatus();
    winston.info('Health Status queried at ' + moment().format());
  } catch (err) {
    winston.error(' Health Status error: ' + err.message);
  }
}

function queryHealthStatus() {
  return new Promise(async (resolve, _void) => {
    try {
      // TODO: you may think Promise.all() is a good idea here but I strongly recommend not to try refactoring it unless you also rewrite this file with OOP (see TODO in the beginning)
      
      const isGlobalPasswordSet = await checkIfGlobalPasswordSet();
      await checkHealthIsFresh(isGlobalPasswordSet);
      
      const prometheusData = await getPrometheusMetrics();
      const prometheusMetrics = reformatPrometheusMetrics(prometheusData);
      
      const nodeHealthData = await calcNodeHealthAndSaveVitalStats(prometheusMetrics, isGlobalPasswordSet);
      await updateNodeHealthStatus(nodeHealthData, isGlobalPasswordSet);
      return resolve();
    } catch (error) {
      winston.error(`Error occurred while querying some of the health info: "${error.message ? error.message : 'no message'}"`);
      return resolve();
    }
  }).timeout(config.healthCheck.requestTimeout - 80);
}

function getPrometheusMetrics() {
  if (!process.env['prometheusHost']) {
    throw Error('prometheusHost env var is not set - unable to get prometheus data');
  }
  const options = {
    method: 'GET',
    url: `http://${process.env['prometheusHost']}/prometheus/api/v1/query?query=health_check`,
    followRedirects: false,
    timeout: config.healthCheck.requestTimeout - 100,
    json: true,
  };
  return rp(options);
}

async function checkIfGlobalPasswordSet() {
  const options = {
    method: 'GET',
    url: `http://${process.env['vaultWrapperHost']}/strato/v2.3/verify-password`,
    followRedirects: false,
    timeout: config.healthCheck.requestTimeout - 100,
    json: true,
  };

  return await rp(options);
}

function reformatPrometheusMetrics(obj) {
  if (!(obj && obj.data && obj.data.result)) {
    winston.warn(`Not Found results while querying health status: prometheus path might be incorrect`);
    return {};
  }
  const timeNow = Date.now() / 1000;

  let res = obj.data.result;

  const ret = {};
  const checkJobs = Object.assign({}, neededJobs);
  res.forEach((elem) => {
    let name, value, loc;
    if (elem && elem.metric && elem.value && elem.value.length >= 2) {
      name = elem.metric.job;
      loc = elem.metric.location.toString();

      // check and remove from checkJObs list
      if ((loc in checkJobs) && (checkJobs[loc] == name)) {
        delete checkJobs[loc];
      } else {
        winston.warn(`Jobs are updated? The following prometheus job is not in the check list required: `, loc);
      }

      ret[name] = (Math.abs(timeNow - elem.value[0]) < config.healthCheck.pollFrequency * config.healthCheck.pollTimeoutsForUnhealthy / 1000) && (elem.value[1] == 1) ? true : false;
    } else {
      winston.info(`Metric format is updated; need to update its handling`);
    }
  })

  Object.keys(checkJobs).forEach((elem) => {
    ret[checkJobs[elem]] = false;
    winston.warn(`${checkJobs[elem]} : ${elem} not found in the prometheus response; Not started`);
  })

  winston.info('Create entry for latest health status:', ret);

  return ret;
}

//TODO: refactor - make a batch db insert for all stats at once, divide node health calc and db insert (ridiculous function name)
async function calcNodeHealthAndSaveVitalStats(prometheusHealthMetrics, isGlobalPasswordExist) {
  let isNodeHealthy = true;
  let currentTime = Date.now();
  let failedChecks = [];

  Object.keys(prometheusHealthMetrics).forEach(async (keyProcess) => {
    if (!prometheusHealthMetrics[keyProcess]) {
      failedChecks.push(keyProcess);
    }
    isNodeHealthy = prometheusHealthMetrics[keyProcess] && isNodeHealthy;
    await models.HealthStat.create({
      processName: keyProcess,
      HealthStatus: prometheusHealthMetrics[keyProcess],
      timestamp: currentTime
    });
  });

  if (isOauthEnabled && !isGlobalPasswordExist) {
    isNodeHealthy = false;
    failedChecks.push('stratoPassword')
  }

  return [isNodeHealthy, failedChecks];
}

async function updateNodeHealthStatus(nodeHealthData, isGlobalPasswordExist) {
  let currentTime = Date.now();
  
  // TODO: move checkSystemInfo out of here!
  let [systemInfoStatus, systemInfo] = await checkSystemInfo(isGlobalPasswordExist);

  // TODO: Should the unhealthy 'SystemInfoStat' make the HealthStat false??? Or add the status as a separate value in /health output
  let [stat, created] = await models.CurrentHealth.findOrCreate({
    where: { processName: 'HealthStat' }, defaults: {
      latestHealthStatus: nodeHealthData[0],
      latestCheckTimestamp: currentTime,
      additionalInfo: nodeHealthData[1].toString(),
      lastFailureTimestamp: currentTime  // default first time marked as failure
    }
  })
  if (!created) {
    await stat.update(
      {
        latestCheckTimestamp: currentTime,
        latestHealthStatus: nodeHealthData[0],
        additionalInfo: nodeHealthData[1].toString(),
        lastFailureTimestamp: nodeHealthData[0] ? stat.lastFailureTimestamp : currentTime
      },
      {
        where: { processName: 'HealthStat' }
      }
    );
  }
  let [statSys, createdSys] = await models.CurrentHealth.findOrCreate({
    where: { processName: 'SystemInfoStat' }, defaults: {
      latestHealthStatus: systemInfoStatus,
      latestCheckTimestamp: currentTime,
      additionalInfo: JSON.stringify(systemInfo),
      lastFailureTimestamp: currentTime  // default first time marked as failure
    }
  })
  if (!createdSys) {
    await statSys.update(
      {
        latestCheckTimestamp: currentTime,
        latestHealthStatus: systemInfoStatus,
        additionalInfo: JSON.stringify(systemInfo),
        lastFailureTimestamp: systemInfoStatus ? statSys.lastFailureTimestamp : currentTime
      },
      {
        where: { processName: 'SystemInfoStat' }
      })
  }
  return
}

async function checkHealthIsFresh(isGlobalPasswordExist) {
  try {
    const healthInfo = await models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat"
      },
      attributes: [
        'latestHealthStatus',
        'latestCheckTimestamp',
        'lastFailureTimestamp'
      ],
      raw: true,
    })


    const currentTime = Date.now();
    if (healthInfo) {
      const isHealthcheckUptodate = ((currentTime - healthInfo.latestCheckTimestamp) < config.healthCheck.pollFrequency * config.healthCheck.pollTimeoutsForUnhealthy);
      if (!isHealthcheckUptodate) {
        const currentStatus = [false, 'Latest health check is outdated'];
        await updateNodeHealthStatus(currentStatus, isGlobalPasswordExist);
      }
    }
  } catch (err) {
    winston.warn(`Error occurred while checking and comparing the latest health: ${err.message ? err.message : err} `);
    const currentStatus = [false, 'Server error: could not calculate the health status'];
    await updateNodeHealthStatus(currentStatus, isGlobalPasswordExist);
  }
}


async function checkSystemInfo(isGlobalPasswordExist) {
  try {
    let additional_info = [];
    let sysInfoCollected = {}
    let isHealthy = true;
    const [memdata, metadataLoad, metadataFs, metadataFsStat, metadataNetwork] = await Promise.all([
      si.mem(),
      si.currentLoad(),
      si.fsSize(),
      si.fsStats(),
      si.networkStats(),
    ]);

    sysInfoCollected.mem_active = memdata.active;
    sysInfoCollected.mem_active = memdata.active;
    sysInfoCollected.mem_free = memdata.free;
    sysInfoCollected.mem_available = memdata.available;

    if (memdata.available / memdata.total * 100 < config.healthCheck.memoryUsageBound) {
      isHealthy = false;
      additional_info.push("Low Memory")
    }
    // FIXME: the callback function is async and the response may come late and be unprocessed!
    // Why checking the disk space with both - `diskspace` and `si` ?? Can we fully remove this faulty `diskspace` code block?
    disk.check('/', function (err, info) {
      if (err) {
        winston.warn("Error when checking for disk usage", err);
        isHealthy = false;
        additional_info.push("Could not check disk space")
      } else {
        const diskUsageRatio = info.free / info.total * 100;
        sysInfoCollected.disk_usage = diskUsageRatio;
        if (diskUsageRatio < config.healthCheck.diskUsageBound) {
          isHealthy = false;
          additional_info.push("Low Disk Space")
        }
      }
    })
    sysInfoCollected.currentLoad = metadataLoad.currentload;

    const fss = []
    metadataFs.forEach(function (fs) {
      const fsDetails = {}
      fsDetails.name = fs.fs;
      fsDetails.fsSize = fs.size;
      fsDetails.fsSize_use = fs.use;
      fsDetails.fsSize_used = fs.used;
      fsDetails.fsSize_size = fs.size;
      fss.push(fsDetails)
      if ((100 - fsDetails.fsSize_use) <= config.healthCheck.diskUsageBound) {
        isHealthy = false;
        additional_info.push(`Low Disk Space on ${fsDetails.name}`)
      }
    })
    sysInfoCollected.fsSize = fss;
    sysInfoCollected.fsStats_rx = metadataFsStat.rx;
    sysInfoCollected.fsStats_wx = metadataFsStat.wx;

    const nwStats = []
    metadataNetwork.forEach(function (ntStat) {
      const nsStatDetails = {}
      nsStatDetails.iface = ntStat.iface;
      nsStatDetails.networkStats_rx_bytes = ntStat.rx_bytes;
      nsStatDetails.networkStats_tx_bytes = ntStat.tx_bytes;
      nwStats.push(nsStatDetails)
    })
    sysInfoCollected.networkStats = nwStats;

    if (isOauthEnabled && !isGlobalPasswordExist) {
      isHealthy = false;
      additional_info.push("STRATO password is not set")
    }

    if (additional_info) {
      sysInfoCollected.Alerts = additional_info
    }

    winston.info("sysInfoCollected at checkSystemInfo: ", sysInfoCollected)
    return [isHealthy, sysInfoCollected];
  } catch (e) {
    winston.warn(`Error ${e.message ? e.message : ''} occurred while checking System Information`)
    const currentStatus = [false, ['Error when checking System Information']];
    await updateNodeHealthStatus(currentStatus, isGlobalPasswordExist);
  }
}

module.exports = {
  updateNodeHealthStatus,
  calcNodeHealthAndSaveVitalStats,
  reformatPrometheusMetrics,
  neededJobs
}
