/* jshint esnext: true */
require('co-mocha')
const winston = require('winston-color');
const env = process.env.NODE_ENV || 'development';
const rp = require('request-promise');
const models = require('../models');
const nodeHealthCheckJs = require('../daemons/node-health-check')
const stallCheckJs = require('../daemons/stall-check')
const sampleResponse = require('./testdata/prometheusFailResponse')
const sampleResponse2 = require('./testdata/prometheusCorrectResponse')
const config = require('../config/app.config');
const ba = require('blockapps-rest')

const { assert } = ba.common

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const timeout = config.healthCheck.pollFrequency;

describe('Tests - Node-level Health Check', function () {
    this.timeout(timeout);

    console.log(sampleResponse)
    it('HealthStat update - FAILURE', async function () {
        let testObj = sampleResponse;
        const res = nodeHealthCheckJs.compareTimeStamp(testObj);
        const stat = await nodeHealthCheckJs.updateHealthStat(res);
        await nodeHealthCheckJs.updateCurrentHealth(stat);
        assert.equal(stat[0], false, "Unhealthy");
        assert.equal(stat[1].sort(), Object.values(nodeHealthCheckJs.neededJobs).sort(), 'Errored Processes')
        const entriesAdded = await models.HealthStat.findAll({
            attributes: ['processName', 'HealthStatus'],
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
        const currentTime = Date.now();
        assert.equal(currentStat.dataValues.latestHealthStatus, false, `Health Stat`)
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp' )

        assert.equal(Math.abs(currentStat.dataValues.lastFailureTimestamp - currentStat.dataValues.latestCheckTimestamp) < config.healthCheck.requestTimeout, true, 'Last Failure Timestamp' )

    })

    it('HealthStat update - SUCCESS', async function () {
        let testObj = sampleResponse2;
        const res = nodeHealthCheckJs.compareTimeStamp(testObj);
        const stat = await nodeHealthCheckJs.updateHealthStat(res);
        await nodeHealthCheckJs.updateCurrentHealth(stat);
        assert.equal(stat[0], true, "Healthy");
        assert.equal(stat[1], [], "Errored Processes")
        let entriesAdded;
        for (let i = 0; i < 2; i++) {
            entriesAdded = await models.HealthStat.findAll({
                limit: 4,
                order: [ [ 'createdAt', 'DESC' ]],
            })};
        entriesAdded.forEach((elem) => {
            assert.equal(elem.dataValues.HealthStatus, true, `${elem.dataValues.processName} Status`);
        })
        const currentStat = await models.CurrentHealth.findOne({
            where: {
                processName: "HealthStat",
            },
        });
        assert.equal(currentStat.dataValues.latestHealthStatus, true, `Current Health`)
        const currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp' )
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
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp' )

        assert.equal(Math.abs(currentStat.dataValues.lastFailureTimestamp - currentStat.dataValues.latestCheckTimestamp) < config.healthCheck.requestTimeout, true, 'Last Failure Timestamp' )

    })

    it('StallStat update -- SUCCESS', async function () {

        const lastV = 0;
        const lastP = 1;
        const thisV = 1;
        const checkRes = await stallCheckJs.getCurrentHealth(lastP, lastV, thisV);
        assert.equal(checkRes[0], true, "Healthy");
        await stallCheckJs.updateCurrentHealth(checkRes);
        let currentStat;
        for (let i = 0; i < 2; i++) {
            currentStat = await models.CurrentHealth.findOne({
                where: {
                    processName: "StallStat",
                },
                order: [ [ 'createdAt', 'DESC' ]],
            })};

        assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
        assert.equal(currentStat.dataValues.isBlocksValidInc, true, 'isInc')
        const currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp' )

        assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp' )

    })

    it('StallStat update -- SUCCESS - Zero pending', async function () {

        const lastV = 0;
        const lastP = 0;
        const thisV = 0;
        const checkRes = await stallCheckJs.getCurrentHealth(lastP, lastV, thisV);
        assert.equal(checkRes[0], true, "Healthy");
        await stallCheckJs.updateCurrentHealth(checkRes);
        let currentStat;
        for (let i = 0; i < 2; i++) {
            currentStat = await models.CurrentHealth.findOne({
                where: {
                    processName: "StallStat",
                },
                order: [ [ 'createdAt', 'DESC' ]],
            })};
        assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
        assert.equal(currentStat.dataValues.isBlocksValidInc, false, 'isInc')
        const currentTime = Date.now();
        assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp' )

        assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp' )

    })


    it('Websocket Emission', function* () {


    })

    it('API endpoints', async function () {

    })
})
