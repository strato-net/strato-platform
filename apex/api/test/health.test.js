/* jshint esnext: true */
require('co-mocha')
const winston = require('winston-color');
const env = process.env.NODE_ENV || 'development';
const rp = require('request-promise');
const models = require('../models');
const nodeHealthCheckJs = require('../daemons/node-health-check')
const stallCheckJs = require('../daemons/stall-check')
const sampleResponse = require('./testdata/promethusResponse')
const config = require('../config/app.config');
const ba = require('blockapps-rest')
const env = process.env.NODE_ENV || 'development';

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
        entriesAdded.forEach((elem) => {
            assert.equal(elem.dataValues.HealthStatus, true, `${elem.dataValues.processName} Status`);
        })
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "HealthStat",
            },
        });
        assert.equal(currentStat.dataValues.latestHealthStatus, true, `Current Health`)
        currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < 1000, true, 'Current Timestamp' )
        assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp' )

    })

    it('StallStat update -- FAILURE', async function () {

        const lastV = 0;
        const lastP = 1;
        const thisV = 0;
        const checkRes = await stallCheckJs.getCurrentHealth(lastP, lastV, thisV);
        assert.equal(checkRes[0], false, "Unhealthy");
        await stallCheckJs.updateCurrentHealth(checkRes);
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "StallStat",
            },
            order: [ [ 'createdAt', 'DESC' ]],
        });
        assert.equal(currentStat.dataValues.latestHealthStatus, false, 'Current Health')
        assert.equal(currentStat.dataValues.isBlocksValidInc, false, 'isInc')
        const currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < 1000, true, 'Current Timestamp' )

        assert.equal(Math.abs(currentStat.dataValues.lastFailureTimestamp - currentStat.dataValues.latestCheckTimestamp) < 500, true, 'Last Failure Timestamp' )

    })

    it('StallStat update -- SUCCESS', async function () {

        const lastV = 0;
        const lastP = 1;
        const thisV = 1;
        const checkRes = await stallCheckJs.getCurrentHealth(lastP, lastV, thisV);
        assert.equal(checkRes[0], true, "Healthy");
        await stallCheckJs.updateCurrentHealth(checkRes);
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "StallStat",
            },
            order: [ [ 'createdAt', 'DESC' ]],
        });
        assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
        assert.equal(currentStat.dataValues.isBlocksValidInc, true, 'isInc')
        const currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < 1000, true, 'Current Timestamp' )

        assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp' )

    })

    it('StallStat update -- SUCCESS - Zero pending', async function () {

        const lastV = 0;
        const lastP = 0;
        const thisV = 0;
        const checkRes = await stallCheckJs.getCurrentHealth(lastP, lastV, thisV);
        assert.equal(checkRes[0], true, "Healthy");
        await stallCheckJs.updateCurrentHealth(checkRes);
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "StallStat",
            },
            order: [ [ 'createdAt', 'DESC' ]],
        });
        assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
        assert.equal(currentStat.dataValues.isBlocksValidInc, false, 'isInc')
        const currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < 1000, true, 'Current Timestamp' )

        assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp' )

    })


    it('Websocket Emission', function* () {


    })

    it('API endpoints', async function () {

    })
})
