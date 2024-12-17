const winston = require("winston-color");
const models = require("../models");
const BlockDataRef = require("../models/strato/eth/blockDataRef");
const Promise = require("bluebird");
const rp = require("request-promise");
const moment = require("moment");
const si = require("systeminformation");
const config = require("../config/app.config");
const getPbftData = require("../controllers/health")["getPbftData"];
const findView = require("../controllers/health")["findView"];
const os = require('os');

// TODO: do the mass-refactoring of the daemon. Use the OOP! Really, don't even try refactoring this without the main Object (SingleCheck object with methods and shared params). Don't change any db data formats.

const neededJobs = {
  slipstream_main: "slipstream",
  strato_p2p: "strato-p2p",
  vm_main: "vm-runner",
  seq_main: "strato-sequencer",
  // TODO: add vault-proxy in prometheus
  "core-api": "core-api",
};

const maxStalledIntervals = config.healthCheck.maxStalledIntervals;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function singleCheck() {
  try {
    await queryHealthStatus();
    winston.info("Health Status queried at " + moment().format());
  } catch (err) {
    winston.error(" Health Status error: " + err.message);
  }
}

function queryHealthStatus() {
  return new Promise(async (resolve, _void) => {
    try {
      // TODO: you may think Promise.all() is a good idea here but I strongly recommend not to try refactoring it unless you also rewrite this file with OOP (see TODO in the beginning)

      await checkHealthIsFresh();

      const prometheusData = await getPrometheusMetrics();
      const prometheusMetrics = reformatPrometheusMetrics(prometheusData);

      const nodeHealthData = await calcNodeHealthAndSaveVitalStats(
        prometheusMetrics
      );
      await updateNodeHealthStatus(nodeHealthData);
      return resolve();
    } catch (error) {
      winston.error(
        `Error occurred while querying some of the health info: "${
          error.message ? error.message : "no message"
        }"`
      );
      return resolve();
    }
  }).timeout(config.healthCheck.requestTimeout - 80);
}

function getPrometheusMetrics() {
  if (!process.env["PROMETHEUS_HOST"]) {
    throw Error(
      "PROMETHEUS_HOST env var is not set - unable to get prometheus data"
    );
  }
  const options = {
    method: "GET",
    url: `http://${process.env["PROMETHEUS_HOST"]}/prometheus/api/v1/query?query=health_check`,
    followRedirects: false,
    timeout: config.healthCheck.requestTimeout - 100,
    json: true,
  };
  return rp(options);
}

async function checkNodeSyncStallStatus(syncStat) {
  let currentTime = Date.now();

  let {
    lastVmBlockNum = 0,
    lastSeqBlockNum = 0,
    stalledIntervalCount = 0,
  } = syncStat?.additionalInfo ? JSON.parse(syncStat?.additionalInfo) : {};

  let isStalled = false;

  const { number: currVmBlockNum = 0 } = await BlockDataRef.findOne({
    where: {
      pow_verified: true,
      is_confirmed: true,
    },
    order: [["number", "DESC"]],
    attributes: ["number"],
    raw: true,
  });

  const pbftInfo = await getPbftData();
  const { sequence_number: currSeqBlockNum = 0 } = findView(pbftInfo);

  const { isSynced = false} = await getStratoMetadata();

  try {
    if (isSynced) {
      return [
        isSynced,
        {
          stalledIntervalCount: 0,
          lastVmBlockNum: 0,
          lastSeqBlockNum: 0,
          isStalled,
        },
      ];
    } else {
      if (
        currVmBlockNum === lastVmBlockNum &&
        currSeqBlockNum === lastSeqBlockNum
      ) {
        if (stalledIntervalCount < maxStalledIntervals) {
          stalledIntervalCount++;
        } else {
          winston.error(
            `Node stalled during sync at ${currentTime}; went ${
              maxStalledIntervals * (config.healthCheck.pollFrequency / 1000)
            } seconds without increasing block number`
          );
          isStalled = true;
        }
      } else {
        stalledIntervalCount = 0;
      }
      winston.debug(
        `sync check: prev vm block #: ${lastVmBlockNum}, cur vm block #: ${currVmBlockNum}`
      );
      winston.debug(
        `sync check: prev seq block #: ${lastSeqBlockNum}, cur seq block #: ${currSeqBlockNum}`
      );
      winston.debug(
        `sync check: inverval ${stalledIntervalCount} of ${maxStalledIntervals}`
      );

      lastVmBlockNum = currVmBlockNum;
      lastSeqBlockNum = currSeqBlockNum;
    }
  } catch (e) {
    winston.warn(
      `Error ${
        e.message ? e.message : ""
      } occurred while checking node's stall status`
    );
  }

  const additionalSyncInfo = {
    stalledIntervalCount,
    lastVmBlockNum,
    lastSeqBlockNum,
    isStalled,
  };

  return [isSynced, additionalSyncInfo];
}

async function getStratoMetadata() {
  const options = {
    method: "GET",
    url: `http://${process.env['STRATO_HOSTNAME']}:${process.env['STRATO_PORT_API']}/eth/v1.2/metadata`,
    followRedirects: false,
    timeout: config.healthCheck.requestTimeout - 100,
    json: true,
  };

  try {
    return await rp(options);
  } catch (error) {
    winston.error('Error fetching Strato metadata:', error);
    return {}; // Return a default value in case of error
  }
}

// TODO rewrite this guy!
// Should return an object like: 
// {
//   'core-api': true,
//   slipstream: true,
//   'strato-p2p': true,
//   'strato-sequencer': true,
//   'vm-runner': true
// }
// but the logic must be simpler and prevent issues when no results are returned.
  function reformatPrometheusMetrics(obj) {
  if (!(obj && obj.data && obj.data.result)) {
    winston.warn(
      `Not Found results while querying health status: prometheus path might be incorrect`
    );
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
      if (loc in checkJobs && checkJobs[loc] == name) {
        delete checkJobs[loc];
      } else {
        winston.warn(
          `Jobs are updated? The following prometheus job is not in the check list required: `,
          loc
        );
      }

      ret[name] =
        Math.abs(timeNow - elem.value[0]) <
          (config.healthCheck.pollFrequency *
            config.healthCheck.pollTimeoutsForUnhealthy) /
            1000 && elem.value[1] == 1
          ? true
          : false;
    } else {
      winston.error(`Unexpected Prometheus response format`);
    }
  });

  Object.keys(checkJobs).forEach((elem) => {
    ret[checkJobs[elem]] = false;
    winston.warn(
      `${checkJobs[elem]} : ${elem} not found in the prometheus response; Not started`
    );
  });

  winston.info("Create entry for latest health status:", ret);

  // TODO: Quick dirty fix for cases with empty metrics array returned from Prometheus - REWRITE the whole thing!
  if (!Array.isArray(res) || res.length === 0) {
    winston.error('Unexpected format of Prometheus metrics, or the metrics are empty!')
    let newReturn = {};
    for (let key in neededJobs) {
      newReturn[neededJobs[key]] = false;
    }
    return newReturn;
  }
  
  return ret;
}

//TODO: refactor - make a batch db insert for all stats at once, divide node health calc and db insert (ridiculous function name)
async function calcNodeHealthAndSaveVitalStats(prometheusHealthMetrics) {
  let isNodeHealthy = true;
  let currentTime = Date.now();
  let failedChecks = [];

  Object.keys(prometheusHealthMetrics).forEach(async (keyProcess) => {
    if (!prometheusHealthMetrics[keyProcess]) {
      failedChecks.push(`${keyProcess} is unavailable`);
    }
    isNodeHealthy = prometheusHealthMetrics[keyProcess] && isNodeHealthy;
    await models.HealthStat.create({
      processName: keyProcess,
      HealthStatus: prometheusHealthMetrics[keyProcess],
      timestamp: currentTime,
    });
  });

  const { isVaultPasswordSet = false  } = await getStratoMetadata();
  if (isVaultPasswordSet === false) {
    winston.error('Vault password not set!');
    isNodeHealthy = false;
    failedChecks.push("STRATO Vault password is not set");
  }


  return [isNodeHealthy, failedChecks];
}

async function updateNodeHealthStatus(nodeHealthData) {
  let currentTime = Date.now();

  // TODO: move checkSystemInfo out of here!
  let [systemInfoStatus, systemInfo] = await checkSystemInfo();

  // TODO: Should the unhealthy 'SystemInfoStat' make the HealthStat false??? Or add the status as a separate value in /health output
  let [stat, created] = await models.CurrentHealth.findOrCreate({
    where: { processName: "HealthStat" },
    defaults: {
      latestHealthStatus: nodeHealthData[0],
      latestCheckTimestamp: currentTime,
      additionalInfo: nodeHealthData[1].toString(),
      lastFailureTimestamp: currentTime, // default first time marked as failure
    },
  });
  if (!created) {
    await stat.update(
      {
        latestCheckTimestamp: currentTime,
        latestHealthStatus: nodeHealthData[0],
        additionalInfo: nodeHealthData[1].toString(),
        lastFailureTimestamp: nodeHealthData[0]
          ? stat.lastFailureTimestamp
          : currentTime,
      },
      {
        where: { processName: "HealthStat" },
      }
    );
  }
  let [statSys, createdSys] = await models.CurrentHealth.findOrCreate({
    where: { processName: "SystemInfoStat" },
    defaults: {
      latestHealthStatus: systemInfoStatus,
      latestCheckTimestamp: currentTime,
      additionalInfo: JSON.stringify(systemInfo),
      lastFailureTimestamp: currentTime, // default first time marked as failure
    },
  });
  if (!createdSys) {
    await statSys.update(
      {
        latestCheckTimestamp: currentTime,
        latestHealthStatus: systemInfoStatus,
        additionalInfo: JSON.stringify(systemInfo),
        lastFailureTimestamp: systemInfoStatus
          ? statSys.lastFailureTimestamp
          : currentTime,
      },
      {
        where: { processName: "SystemInfoStat" },
      }
    );
  }

  let [syncStat, _] = await models.CurrentHealth.findOrCreate({
    where: { processName: "SyncStat" },
    defaults: {
      latestHealthStatus: false,
      latestCheckTimestamp: currentTime,
      additionalInfo: JSON.stringify({
        stalledIntervalCount: 0,
        lastVmBlockNum: 0,
        lastSeqBlockNum: 0,
      }),
      lastFailureTimestamp: currentTime, // default first time marked as failure
    },
  });

  const [isSynced, additionalSyncInfo] = await checkNodeSyncStallStatus(
    syncStat
  );
  await syncStat.update(
    {
      latestCheckTimestamp: currentTime,
      latestHealthStatus: isSynced,
      additionalInfo: JSON.stringify(additionalSyncInfo),
      lastFailureTimestamp: isSynced
        ? syncStat.lastFailureTimestamp
        : currentTime,
    },
    {
      where: { processName: "SyncStat" },
    }
  );

  return;
}

async function checkHealthIsFresh() {
  try {
    const healthInfo = await models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
      ],
      raw: true,
    });

    const currentTime = Date.now();
    if (healthInfo) {
      const isHealthcheckUptodate =
        currentTime - healthInfo.latestCheckTimestamp <
        config.healthCheck.pollFrequency *
          config.healthCheck.pollTimeoutsForUnhealthy;
      if (!isHealthcheckUptodate) {
        const currentStatus = [false, ["Latest health check is outdated"]];
        await updateNodeHealthStatus(currentStatus);
      }
    }
  } catch (err) {
    winston.warn(
      `Error occurred while checking and comparing the latest health: ${
        err.message ? err.message : err
      } `
    );
    const currentStatus = [
      false,
      ["Server error: could not calculate the health status"],
    ];
    await updateNodeHealthStatus(currentStatus);
  }
}

async function checkSystemInfo() {
  try {
    let additional_info = [];
    let sysInfoCollected = {};
    let isHealthy = true;
    const [memdata, cpudata, metadataLoad, metadataFs, metadataNetwork] =
      await Promise.all([
        si.mem(),
        si.cpu(),
        si.currentLoad(),
        si.fsSize(),
        si.networkStats(),
      ]);

      const prevMetrics = await models.CurrentHealth.findOne({
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
      
      const prevSysInfo = prevMetrics ? JSON.parse(prevMetrics.additionalInfo) : {};
  
    // MEMORY
    const useLevel = (1 - memdata.available / memdata.total) * 100;
    const previousMemoryAlert = prevSysInfo.memory?.use?.isHealthy === false;
    const memoryAlert = useLevel >= config.healthCheck.memoryUsedAlertLevel ||
      (previousMemoryAlert && useLevel >= config.healthCheck.memoryUsedCloseLevel);

    sysInfoCollected.memory = {
      active: memdata.active,
      free: memdata.free,
      available: memdata.available,
      total: memdata.total,
      use: {
        value: +useLevel.toFixed(2),
        isHealthy: !memoryAlert,
      },
    };
    if (!sysInfoCollected.memory.use.isHealthy) {
      isHealthy = false;
      additional_info.push(`Low Memory (used ${useLevel.toFixed(2)}%)`);
    }

    const currentLoad = metadataLoad.currentLoad;
    const cpuCount = os.cpus().length;
    
    //covert loads to percents
    const avgLoads = os.loadavg()?.map(load => (load / cpuCount) * (100/2));
    
    //grab 15 min load
    const avgLoad = (avgLoads == null || avgLoads.length < 3) ? 0 : avgLoads[2];
    
    const previousCpuCurrentLoadAlert = prevSysInfo.cpu?.currentLoad?.isHealthy === false;
    const previousCpuAvgLoadAlert = prevSysInfo.cpu?.avgLoad?.isHealthy === false;

    const cpuCurrentLoadAlert = currentLoad >= config.healthCheck.cpuCurrentLoadAlertLevel ||
                                (previousCpuCurrentLoadAlert && currentLoad >= config.healthCheck.cpuCurrentLoadCloseLevel);

    const cpuAvgLoadAlert = avgLoad >= config.healthCheck.cpuAvgLoadAlertLevel ||
                            (previousCpuAvgLoadAlert && avgLoad >= config.healthCheck.cpuAvgLoadCloseLevel);

    // CPU
    sysInfoCollected.cpu = {
      manufacturer: cpudata.manufacturer,
      brand: cpudata.brand,
      cores: cpudata.cores,
      physicalCores: cpudata.physicalCores,
      currentLoad: {
        value: +metadataLoad.currentLoad.toFixed(2),
        isHealthy: !cpuCurrentLoadAlert
      },
      avgLoad: {
        value: +avgLoad.toFixed(2),
        isHealthy: !cpuAvgLoadAlert
      },
    };
    if (!sysInfoCollected.cpu.avgLoad.isHealthy) {
      isHealthy = false;
      additional_info.push(
        `Average CPU load is high (${avgLoad.toFixed(2)})`
      );
    }
    

    // 12/17/24 - comment out current CPU load alarm
    // if (!sysInfoCollected.cpu.currentLoad.isHealthy) {
    //   isHealthy = false;
    //   additional_info.push(
    //     `Current CPU load is high (${metadataLoad.currentLoad.toFixed(2)})`
    //   );
    // }

    // FILESYSTEM
    const fsData = [];
    metadataFs.forEach(function (fs) {
      if (fs.fs !== "overlay") {
        const prevFsInfo = prevSysInfo.filesystem?.find(f => f.name === fs.fs);
        const prevFsAlert = prevFsInfo?.use?.isHealthy === false;
        const diskSpaceAlert = fs.use >= config.healthCheck.diskspaceUsedAlertLevel ||
                               (prevFsAlert && fs.use >= config.healthCheck.diskspaceUsedCloseLevel);
        
        fsData.push({
          name: fs.fs,
          size: fs.size,
          used: fs.used,
          use: {
            value: +fs.use.toFixed(2),
            isHealthy: !diskSpaceAlert,
          },
        });
        if (diskSpaceAlert) {
          isHealthy = false;
          additional_info.push(
            `Low Disk Space on ${fs.fs} (used ${fs.use.toFixed(2)}%)`
          );
        }
      }
    });
    fsData.sort((a, b) => b.use.value - a.use.value);
    sysInfoCollected.filesystem = fsData;

    // NETWORK
    const nwData = [];
    metadataNetwork.forEach(function (nwStat) {
      nwData.push({
        interface: nwStat.iface,
        networkStats_rx_bytes: nwStat.rx_bytes,
        networkStats_tx_bytes: nwStat.tx_bytes,
      });
    });
    sysInfoCollected.networkStats = nwData;

    if (additional_info) {
      sysInfoCollected.Alerts = additional_info;
    }

    winston.info(`Sys info collected at ${moment().format()}`);
    winston.debug("sysInfoCollected: ", sysInfoCollected);
    return [isHealthy, sysInfoCollected];
  } catch (e) {
    winston.warn(
      `Error ${
        e.message ? e.message : ""
      } occurred while checking System Information`
    );
    const currentStatus = [false, ["Error when checking System Information"]];
    await updateNodeHealthStatus(currentStatus);
  }
}

module.exports = {
  singleCheck,
  updateNodeHealthStatus,
  calcNodeHealthAndSaveVitalStats,
  reformatPrometheusMetrics,
  neededJobs,
};
