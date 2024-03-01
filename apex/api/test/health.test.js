/* jshint esnext: true */

const assert = require('chai').assert;
const models = require('../models');
const nodeHealthCheckJs = require('../daemons/node-health-check-utils')
const stallCheckJs = require('../daemons/stall-check-utils')
const prometheusFailResponse = require('./testdata/prometheusFailResponse')
const prometheusCorrectResponse = require('./testdata/prometheusCorrectResponse')
const config = require('../config/app.config');



process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const timeout = config.healthCheck.pollFrequency;

// TODO: remove global password from here after the node-health-check.js is refactored, change tests accordingly
const isGlobalPasswordSet = true;


describe('Tests - Node-level Health Check', function () {
  this.timeout(timeout);
  before(async function () {
    const currentTime = Date.now();
    prometheusCorrectResponse.data.result.forEach((elem) => {
      elem.value[0] = currentTime / 1000;
    })

  })

  it('HealthStat update - FAILURE', async function () {
    let testObj = prometheusFailResponse;
    const res = nodeHealthCheckJs.reformatPrometheusMetrics(testObj);
    const stat = await nodeHealthCheckJs.calcNodeHealthAndSaveVitalStats(res, isGlobalPasswordSet);
    await nodeHealthCheckJs.updateNodeHealthStatus(stat);
    assert.equal(stat[0], false, "Unhealthy");
    assert.equal(stat[1].sort().toString(), Object.values(nodeHealthCheckJs.neededJobs).sort().toString(), 'Errored Processes')
    const entriesAdded = await models.HealthStat.findAll({
      attributes: ['processName', 'HealthStatus'],
      limit: 4,
      order: [['createdAt', 'DESC']],
    })

    entriesAdded.forEach((elem) => {
      assert.equal(elem.dataValues.HealthStatus, false, `${elem.dataValues.processName} Status`);
    })
    const currentStat = await models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat",
      },
    })
    const currentTime = Date.now();
    assert.equal(currentStat.dataValues.latestHealthStatus, false, `Health Stat`)
    assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp')

    assert.equal(Math.abs(currentStat.dataValues.lastFailureTimestamp - currentStat.dataValues.latestCheckTimestamp) < config.healthCheck.requestTimeout, true, 'Last Failure Timestamp')

  })
/* 
  it('HealthStat update - FAILURE - Data not recent', async function () {
    let testObj = prometheusCorrectResponse;
    const currentTime = Date.now();
    testObj.data.result.forEach((elem) => {
      elem.value[0] = (currentTime - config.healthCheck.pollFrequency * config.healthCheck.pollTimeoutsForUnhealthy)/1000;
    })
    const res = nodeHealthCheckJs.reformatPrometheusMetrics(testObj);
    const stat = await nodeHealthCheckJs.calcNodeHealthAndSaveVitalStats(res, isGlobalPasswordSet);
    await nodeHealthCheckJs.updateNodeHealthStatus(stat);
    assert.equal(stat[0], false, "Unhealthy");
    assert.equal(stat[1].sort().toString(), Object.values(nodeHealthCheckJs.neededJobs).sort().toString(), 'Errored Processes')
    const entriesAdded = await models.HealthStat.findAll({
        attributes: ['processName', 'HealthStatus'],
        limit: 4,
        order: [['createdAt', 'DESC']],
      })
    entriesAdded.forEach((elem) => {
      assert.equal(elem.dataValues.HealthStatus, false, `${elem.dataValues.processName} Status`);
    })
  })
*/
  it('HealthStat update - SUCCESS', async function () {
    let testObj = prometheusCorrectResponse;
    const currentTime = Date.now();
    testObj.data.result.forEach((elem) => {
      elem.value[0] = currentTime/1000;
    })
    const res = nodeHealthCheckJs.reformatPrometheusMetrics(testObj);
    const stat = await nodeHealthCheckJs.calcNodeHealthAndSaveVitalStats(res, isGlobalPasswordSet);
    await nodeHealthCheckJs.updateNodeHealthStatus(stat);
    assert.equal(stat[0], true, "Healthy");
    assert.equal(stat[1].concat().toString(), [].toString(), "Errored Processes")
    const entriesAdded = await models.HealthStat.findAll({
        limit: 4,
        order: [['createdAt', 'DESC']],
      })
    entriesAdded.forEach((elem) => {
      assert.equal(elem.dataValues.HealthStatus, true, `${elem.dataValues.processName} Status`);
    })
    const currentStat = await models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat",
      },
    });
    assert.equal(currentStat.dataValues.latestHealthStatus, true, `Current Health`)
    assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp')
    assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp')

  })

  it('StallStat update -- FAILURE', async function () {
    
    const lastP = 1;
    const thisP = 1;
    const lastV = 0;
    const thisV = 0;
    const checkRes = await stallCheckJs.getCurrentHealth(lastP, thisP, lastV, thisV);
    assert.equal(checkRes.stallHealthStatus, false, "Unhealthy");
    await stallCheckJs.updateCurrentStallStat(checkRes);
    const currentStat = await models.CurrentHealth.findOne({
      where: {
        processName: "StallStat",
      },
    });
    assert.equal(currentStat.dataValues.latestHealthStatus, false, 'Current Health')
    assert.equal(currentStat.dataValues.validBlocksIncreased, false, 'validBlocksIncreased')
    assert.equal(currentStat.dataValues.hasPendingTxs, true, 'hasPendingTxs')
    const currentTime = Date.now();
    assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp')

    assert.equal(Math.abs(currentStat.dataValues.lastFailureTimestamp - currentStat.dataValues.latestCheckTimestamp) < config.healthCheck.requestTimeout, true, 'Last Failure Timestamp')

  })

  it('StallStat update -- SUCCESS', async function () {
    
    const lastP = 1;
    const thisP = 0;
    const lastV = 0;
    const thisV = 1;
    const checkRes = await stallCheckJs.getCurrentHealth(lastP, thisP, lastV, thisV);
    assert.equal(checkRes.stallHealthStatus, true, "Healthy");
    await stallCheckJs.updateCurrentStallStat(checkRes);
    const currentStat = await models.CurrentHealth.findOne({
      where: {
        processName: "StallStat",
      },
    });

    assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
    assert.equal(currentStat.dataValues.validBlocksIncreased, true, 'validBlocksIncreased')
    assert.equal(currentStat.dataValues.hasPendingTxs, true, 'hasPendingTxs')
    const currentTime = Date.now();
    assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp')

    assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp')

  })
  
  it('StallStat update -- SUCCESS - Has Currently Pending', async function () {
    
    const lastP = 1;
    const thisP = 1;
    const lastV = 0;
    const thisV = 1;
    const checkRes = await stallCheckJs.getCurrentHealth(lastP, thisP, lastV, thisV);
    assert.equal(checkRes.stallHealthStatus, true, "Healthy");
    await stallCheckJs.updateCurrentStallStat(checkRes);
    const currentStat = await models.CurrentHealth.findOne({
      where: {
        processName: "StallStat",
      },
    });
    
    assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
    assert.equal(currentStat.dataValues.validBlocksIncreased, true, 'validBlocksIncreased')
    assert.equal(currentStat.dataValues.hasPendingTxs, true, 'hasPendingTxs')
    const currentTime = Date.now();
    assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp')
    
    assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp')
    
  })
  
  it('StallStat update -- SUCCESS - Zero pending', async function () {
    
    const lastP = 0;
    const lastV = 0;
    const thisP = 0;
    const thisV = 0;
    const checkRes = await stallCheckJs.getCurrentHealth(lastP, thisP, lastV, thisV);
    assert.equal(checkRes.stallHealthStatus, true, "Healthy");
    await stallCheckJs.updateCurrentStallStat(checkRes);
    const currentStat = await models.CurrentHealth.findOne({
      where: {
        processName: "StallStat",
      },
    });
    assert.equal(currentStat.dataValues.latestHealthStatus, true, 'Current Health')
    assert.equal(currentStat.dataValues.validBlocksIncreased, false, 'validBlocksIncreased')
    assert.equal(currentStat.dataValues.hasPendingTxs, false, 'hasPendingTxs')
    const currentTime = Date.now();
    assert.equal(Math.abs(currentStat.dataValues.latestCheckTimestamp - currentTime) < config.healthCheck.requestTimeout, true, 'Current Timestamp')

    assert.equal((currentStat.dataValues.lastFailureTimestamp < currentStat.dataValues.latestCheckTimestamp), true, 'Last Failure Timestamp')

  })


  it('Websocket Emission', async function () {


  })

  it('API endpoints', async function () {

  })
})
