const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');
const si = require('systeminformation');
const disk = require('diskusage');
const config = require('../config/app.config');

const neededJobs = {
    "slipstream_main":"slipstream",
    "strato_p2p":"strato-p2p",
    "vm_main":"vm-runner",
    "seq_main":"strato-sequencer"
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// DAEMON - query node-health-check every N sec
winston.info('Starting node-health-check with a delay of', config.healthCheck.pollFrequency);
setInterval(async () => {
    try {
        await queryHealthStatus();
        winston.info('Health Status queried at ' + moment().format());
    } catch (err) {
        winston.error(' Health Status error: ' + err.message);
    }
}, config.healthCheck.pollFrequency);

function queryHealthStatus() {
    return new Promise(async (resolve, _void) => {
        try {
            const metricsResult = await getHealthPrometheus();
            await checkLatest();
            const healthStatus = await compareTimeStamp(metricsResult);
            const overallStatus = await updateHealthStat(healthStatus);
            await updateCurrentHealth(overallStatus);
            return resolve();
        } catch (error) {
            winston.warn(`Error ${error.message ? error.message : ''} occurred while querying health status`);
        }
    }).timeout(config.healthCheck.requestTimeout - 80);
}

function getHealthPrometheus() {
    const ipaddr = (env == 'production') ? 'prometheus:9090' : 'localhost';
    const options = {
        method: 'GET',
        url: `http://${ipaddr}/prometheus/api/v1/query?query=health_check`,
        followRedirects: false,
        timeout: config.healthCheck.requestTimeout-100,
        json: true,
        // TODO: Modify to work with secured networks
        auth: {
            'user': 'admin',
            'pass': 'admin'
        }
    };
    return rp(options);
}

function compareTimeStamp(obj) {
    if (!(obj && obj.data && obj.data.result)) {
        winston.warn(`Not Found results while querying health status: prometheus path might be incorrect`);
        return {};
    }
    const timeNow = Date.now() / 1000;

    res = obj.data.result;

    const ret = {};
    const checkJobs = Object.assign({}, neededJobs);
    res.forEach((elem) => {
        let name, value,loc;
        if (elem && elem.metric && elem.value && elem.value.length >= 2){
            name = elem.metric.job;
            loc = elem.metric.location.toString();

            // check and remove from checkJObs list
            if ((loc in checkJobs) && (checkJobs[loc] == name)){
                delete checkJobs[loc];
            } else {
                winston.warn(`Jobs are updated? The following prometheus job is not in the check list required: `, loc);
            }

            ret[name] = (Math.abs(timeNow - elem.value[0]) < config.healthCheck.pollFrequency * config.healthCheck.pollTimeoutsForUnhealthy /1000 ) && (elem.value[1] == 1) ? true : false;
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

async function updateHealthStat(healthStatus) {
    let overallStat = true;
    let currentTime = Date.now();
    let failedTask = [];
    Object.keys(healthStatus).forEach(async(keyProcess) => {
        if (!healthStatus[keyProcess]){
            failedTask.push(keyProcess);
        }
        overallStat = healthStatus[keyProcess] && overallStat;
        await models.HealthStat.create({
            processName: keyProcess,
            HealthStatus: healthStatus[keyProcess],
            timestamp: currentTime
        });
    });
    return [overallStat,failedTask];
}

async function updateCurrentHealth(overallStat) {
    let currentTime = Date.now();
    let [systemInfoStatus, systemInfo] = await checkSystemInfo();

    let [stat, created] = await models.CurrentHealth.findOrCreate({where: {processName: 'HealthStat'}, defaults: {
            latestHealthStatus: overallStat[0],
            latestCheckTimestamp: currentTime,
            additionalInfo: overallStat[1].toString(),
            lastFailureTimestamp: currentTime  // default first time marked as failure
        }
    })
    if (!created) {
      await stat.update(
          {
            latestCheckTimestamp: currentTime,
            latestHealthStatus: overallStat[0],
            additionalInfo: overallStat[1].toString(),
            lastFailureTimestamp: overallStat[0] ? stat.lastFailureTimestamp : currentTime
          },
          {
            where: {processName: 'HealthStat'}
          }
      );
    }
    let [statSys, createdSys] = await models.CurrentHealth.findOrCreate({where: {processName: 'SystemInfoStat'}, defaults: {
          latestHealthStatus: systemInfoStatus,
          latestCheckTimestamp: currentTime,
          additionalInfo: JSON.stringify(systemInfo),
          lastFailureTimestamp: currentTime  // default first time marked as failure
    }})
    if (!createdSys){
      await statSys.update(
          {latestCheckTimestamp: currentTime,
            latestHealthStatus: systemInfoStatus,
            additionalInfo: JSON.stringify(systemInfo),
            lastFailureTimestamp: systemInfoStatus ? statSys.lastFailureTimestamp : currentTime
          },
          {where: {processName: 'SystemInfoStat'}
          })
    }
    return
}

function formatPromethusTimestamp(timestamp) {
    return ( timestamp.toString().split('.')[0])
}

async function checkLatest() {
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
      const nodeUp = ((currentTime - healthInfo.latestCheckTimestamp) < config.healthCheck.pollFrequency * config.healthCheck.pollTimeoutsForUnhealthy);
      if (!nodeUp) {
        const currentStatus = [false, 'Last Check Not Recent'];
        await updateCurrentHealth(currentStatus);
      }
    }
  } catch (e) {
    winston.warn(`Error ${e.message ? e.message : ''} occurred while checking and comparing the latest health`)
    const currentStatus = [false, 'Last Check Not Recent'];
    await updateCurrentHealth(currentStatus);
  }
}


async function checkSystemInfo() {
  try {
    let additional_info = [];
    let sysInfoCollected = {}
    let isHealthy = true;
    await si.mem().then(data => {
      sysInfoCollected.mem_active = data.active;
      sysInfoCollected.mem_free = data.free;
      sysInfoCollected.mem_available = data.available;

      if (data.available / data.total * 100 < config.healthCheck.diskUsageBound) {
        isHealthy = false;
        additional_info.push("Low Memory")
      }
    })
    disk.check('/', function(err, info) {
      if (err) {
        winston.warn("Error when checking for disk usage", err);
        isHealthy = false;
        additional_info.push("Low Disk Space")
      } else {
        const diskUsageRatio = info.free / info.total *100;
        sysInfoCollected.disk_usage = diskUsageRatio;
        if (diskUsageRatio < config.healthCheck.memoryUsageBound) {
          isHealthy = false;
          additional_info.push("Low Disk Space")
        }
      }
    })
    await si.currentLoad().then(data => {
      sysInfoCollected.currentLoad = data.currentload;
    })

    const fss = []
    await si.fsSize().then(data => {
      data.forEach(function (fs) {
        const fsDetails = {}
        fsDetails.name = fs.fs;
        fsDetails.fsSize = fs.size;
        fsDetails.fsSize_use = fs.use;
        fsDetails.fsSize_used = fs.used;
        fsDetails.fsSize_size = fs.size;
        fss.push(fsDetails)
        if (fsDetails.fsSize_use < config.healthCheck.diskUsageBound) {
          isHealthy = false;
          additional_info.push(`Low Disk Space on ${fsDetails.name}`)
        }
      })
      sysInfoCollected.fsSize = fss;
    })
    await si.fsStats().then(data => {
      sysInfoCollected.fsStats_rx = data.rx;
      sysInfoCollected.fsStats_wx = data.wx;
    })

    const nwStats = []
    await si.networkStats().then(data => {
      data.forEach(function (ntStat) {
        const nsStatDetails = {}
        nsStatDetails.iface = ntStat.iface;
        nsStatDetails.networkStats_rx_bytes = ntStat.rx_bytes;
        nsStatDetails.networkStats_tx_bytes = ntStat.tx_bytes;
        nwStats.push(nsStatDetails)
      })
      sysInfoCollected.networkStats = nwStats;
    })

    if (additional_info){
      sysInfoCollected.Alerts = additional_info
    }
    winston.info("sysInfoCollected at checkSystemInfo: ", sysInfoCollected)
    return [isHealthy, sysInfoCollected];
  } catch (e) {
    winston.warn(`Error ${e.message ? e.message : ''} occurred while checking System Information`)
    const currentStatus = [false, ['Error when checking System Information']];
    await updateCurrentHealth(currentStatus);
  }
}

module.exports = {
    updateCurrentHealth,
    updateHealthStat,
    compareTimeStamp,
    neededJobs
}
