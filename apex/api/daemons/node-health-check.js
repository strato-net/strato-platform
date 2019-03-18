const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');

const config = require('../config/app.config');

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
            const metricsResult = await getHealthPrometheus()
            const healthStatus = await findTimeStamp(metricsResult)
            let overallStat = true;
            let currentTime = moment().format();
            Object.keys(healthStatus).forEach(async (keyProcess) => {
                overallStat = healthStatus[keyProcess] && overallStat;
                await models.healthStat.create({
                    processName: keyProcess,
                    HealthStatus: healthStatus[keyProcess],
                    timestamp: currentTime
                });
            });
            await models.Stat.findOrCreate({where: {processName: 'Overall'}, defaults: {
                latestHealthStatus: overallStat,
                latestCheckTimestamp: currentTime,
                lastFailureTimestamp: overallStat ? null : currentTime
            }}).then(([stat, created]) => {
                if (!created){
                    stat.update(
                        {latestCheckTimestamp: currentTime,
                            latestHealthStatus: overallStat,
                            lastFailureTimestamp: overallStat ? stat.lastFailureTimestamp : currentTime
                        }, {where: {processName: 'Overall'}})
                }
            }).catch(err => {
                    winston.warn(`Error ${err.message ? err.message : ''} occurred while creating and updating tables`);
                });
            return resolve();
        } catch (error) {
            winston.warn(`Error ${error.message ? error.message : ''} occurred while querying health status`);
            return resolve();
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

function findTimeStamp(obj) {
    if (!(obj && obj.data && obj.data.result)) {
        winston.warn(`Not Found results while querying health status: prometheus path might be incorrect`);
        return {};
    }
    const timeNow = Date.now();

    res = obj.data.result;

    const ret = {};

    res.forEach((elem) => {
        if (elem && elem.metric && elem.value && elem.value.length >= 2){
            name = elem.metric.job;
            value = elem.value[0].toString().split('.').join('');
            if (value.length < timeNow.toString().length){
                value = parseInt(value + '0'*(timeNow.toString().length - value.length));
            }
        ret[name] = (Math.abs(timeNow - value) < config.healthCheck.maxResponseRange) && (elem.value[1] == 1) ? true : false;
        } else {
        winston.info(`Metric format is updated; need to update its handling`);
        }
    })

    if (res.length == 0){
        winston.warn(`Metrics will only be generated after the initiation of the first transaction`);
    } else {
        winston.info('Create entry for latest health status:', ret);
    }

    return ret;
}
