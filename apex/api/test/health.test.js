/* jshint esnext: true */
require('co-mocha')
const winston = require('winston-color');
const env = process.env.NODE_ENV || 'development';
const models = require('../models');
const nodeHealthCheckJs = require('../daemons/node-health-check')
const sampleResponse = require('./testdata/promethusResponse')
const config = require('../config/app.config');
const ba = require('blockapps-rest')

const { assert } = ba.common

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const timeout = 60000;

describe('Tests - Node-level Health Check', function () {
    this.timeout(timeout);

    console.log(sampleResponse)
    it('HealthStat update - FAILURE - Timestamp Comparison', async function () {
        let testObj = sampleResponse;
        let currentTime = Date.now() / 1000;
        testObj.data.result[0].value[0] = currentTime - config.healthCheck.maxResponseRange;
        const res = nodeHealthCheckJs.compareTimeStamp(testObj);
        const stat = await nodeHealthCheckJs.updateHealthStat(res);
        await nodeHealthCheckJs.updateCurrentHealth(stat);
        assert.equal(stat, false, "Unhealthy");
        const entriesAdded = await models.HealthStat.findAll({
            limit: 4,
            order: [ [ 'createdAt', 'DESC' ]],
        });

        entriesAdded.forEach((elem) => {
            assert.equal(elem.dataValues.HealthStatus, false, `${elem.dataValues.processName} Status`);
        })
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "HealthStat",
            },
        });
        currentTime = Date.now();
        assert.equal(currentStat.dataValues.latestHealthStatus, false, `Health Stat`)
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < 1000, true, 'Current Timestamp' )

        assert.equal(Math.abs(currentStat.dataValues.lastFailureTimestamp - currentStat.dataValues.latestCheckTimestamp) < 500, true, 'Last Failure Timestamp' )

    })

    it('HealthStat update - SUCCESS', async function () {
        let testObj = sampleResponse;
        let currentTime = Date.now() / 1000;
        testObj.data.result.forEach((elem) => {
            elem.value[0] = currentTime;
        })
        const res = nodeHealthCheckJs.compareTimeStamp(testObj);
        const stat = await nodeHealthCheckJs.updateHealthStat(res);
        await nodeHealthCheckJs.updateCurrentHealth(stat);
        assert.equal(stat, true, "Healthy");
        const entriesAdded = await models.HealthStat.findAll({
            limit: 4,
            order: [ [ 'createdAt', 'DESC' ]],
        });
        console.log(entriesAdded[0])
        entriesAdded.forEach((elem) => {
            assert.equal(elem.dataValues.HealthStatus, true, `${elem.dataValues.processName} Status`);
        })
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "HealthStat",
            },
        });
        assert.equal(currentStat.dataValues.latestHealthStatus, true, `Health Stat`)
        currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < 1000, true, 'Current Timestamp' )
        assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp' )

    })

    it('StallStat update -- FAILURE', function* () {

    })

    it('StallStat update -- SUCCESS', function* () {

    })

    it('check emission of GET_HEALTH', function* () {

    })

    it('check emission of GET_NODE_UPTIME', function* () {

    })
})
