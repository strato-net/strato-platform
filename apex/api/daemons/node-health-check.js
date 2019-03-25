const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');

const config = require('../config/app.config');
const neededJobs = {
    "slipstream_processor":"slipstream",
    "p2p_client":"strato-p2p",
    "bagger_build":"ethereum-vm",
    "vm_seqevents":"ethereum-vm",
    "pbft_commit":"strato-sequencer"
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
    const options = {
        method: 'GET',
        url: `http://localhost/prometheus/api/v1/query?query=health_check`,
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
            value = formatPromethusTimestamp(elem.value[0]);
            ret[name] = (Math.abs(timeNow - value) < config.healthCheck.maxResponseRange) && (elem.value[1] == 1) ? true : false;
        } else {
            winston.info(`Metric format is updated; need to update its handling`);
        }
    })

    Object.keys(checkJobs).forEach((elem) => {
        ret[checkJobs[elem]] = false;
        winston.warn(`${checkJobs[elem]} : ${elem} not found in the prometheus response; Not started`);
    })

    if (res.length == 0){
        winston.warn(`Metrics will only be generated after the initiation of the first transaction`);
    } else {
        winston.info('Create entry for latest health status:', ret);
    }

    return ret;
}

async function updateHealthStat(healthStatus) {
    let overallStat = true;
    let currentTime = Date.now();
    Object.keys(healthStatus).forEach(async(keyProcess) => {
        overallStat = healthStatus[keyProcess] && overallStat;
        await models.HealthStat.create({
            processName: keyProcess,
            HealthStatus: healthStatus[keyProcess],
            timestamp: currentTime
        })
    });
    return overallStat;
}

async function updateCurrentHealth(overallStat) {
    let currentTime = Date.now();
    await models.CurrentHealth.findOrCreate({where: {processName: 'HealthStat'}, defaults: {
                latestHealthStatus: overallStat,
                latestCheckTimestamp: currentTime,
                lastFailureTimestamp: currentTime  // default first time marked as failure
            }}).then(([stat, created]) => {
                if (!created){
                    stat.update(
                        {latestCheckTimestamp: currentTime,
                            latestHealthStatus: overallStat,
                            lastFailureTimestamp: overallStat ? stat.lastFailureTimestamp : currentTime
                        }, {where: {processName: 'HealthStat'}})
                }
            }).catch(err => {
                    winston.warn(`Error ${err.message ? err.message : ''} occurred while creating and updating tables`);
                });
}

function formatPromethusTimestamp(timestamp) {
    return ( timestamp.toString().split('.')[0])
}

module.exports = {
    updateCurrentHealth,
    updateHealthStat,
    compareTimeStamp
}
