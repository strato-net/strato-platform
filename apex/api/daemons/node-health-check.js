const winston = require('winston-color');
const models = require('../models');
const Promise = require('bluebird');
const rp = require('request-promise');
const env = process.env.NODE_ENV || 'development';
const moment = require('moment');
const utils = require('./utils');

const config = require('../config/app.config');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// DAEMON - query node-health-check every N sec
winston.info('Starting node-health-check with a delay of', config.nodePing.pollFrequency);
setInterval(async () => {
    try {
        await queryHealthStatus();
        winston.info('nodes queried at ' + moment().format());
    } catch (err) {
        winston.error('nodes query error: ' + err.message);
    }
}, config.nodePing.pollFrequency);


async function queryHealthStatus() {
    const metricsResult = await getHealthPrometheus()
    const healthStatus = findTimeStamp(metricsResult)

    healthStatus.forEach(async (process) => {
        await models.healthStat.create({
            processName: process,
            HealthStatus: healthStatus[process]? "Success" : "Failure",
            timestamp: moment().format()
        });
    };
}

function getHealthPrometheus() {
    const options = {
        method: 'GET',
        url: `http://prometheus:9090/api/v1/query?query=health_check`,
        followRedirects: false,
        timeout: config.nodePing.requestTimeout-100,
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
        return {};
    }
    const timeNow = new Date.now();
    res = obj.data.result;
    const ret = {};
    res.forEach((elem) => {
        if (elem && elem.metric && elem.value && elem.value.length >= 2){
            name = elem.metric.view_field;
            value = elem.value[0];
            ret[name] = (timeNow - value) < 10 && (elem.value[1] == 1) ? true : false;
        }
    })
    return ret;
}
