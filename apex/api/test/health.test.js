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

describe('Tests - JSON-RPC Health Check', function () {
  const utils = require('../lib/utils');
  const now = Date.now();
  const row = (latestHealthStatus, additionalInfo) => ({
    latestHealthStatus,
    latestCheckTimestamp: now,
    lastFailureTimestamp: now - 60000,
    additionalInfo,
  });
  // HealthStat, StallStat, SystemInfoStat, SyncStat rows of a healthy, synced node
  const healthyNode = () => [
    row(true, ''),
    { ...row(true, null), validBlocksIncreased: true, hasPendingTxs: false },
    row(true, JSON.stringify({ Alerts: [] })),
    row(true, JSON.stringify({ isStalled: false })),
  ];

  it('no JsonRpcStat row yet - node health unaffected', function () {
    const res = utils.consolidateHealthData(...healthyNode(), null);
    assert.equal(res.health, true);
    assert.equal(res.healthStatus, 'HEALTHY');
    assert.equal(res.healthData.jsonRpc.enabled, null);
  });

  it('JSON-RPC disabled on the node - node health unaffected even if marked failed', function () {
    const res = utils.consolidateHealthData(...healthyNode(), row(false, JSON.stringify({ enabled: false })));
    assert.equal(res.health, true);
    assert.equal(res.healthStatus, 'HEALTHY');
    assert.equal(res.healthIssues.length, 0);
    assert.equal(res.healthData.jsonRpc.enabled, false);
  });

  it('JSON-RPC enabled and answering - HEALTHY with details', function () {
    const details = { enabled: true, url: 'http://node:8545/', blockNumber: 1234, consecutiveFailures: 0 };
    const res = utils.consolidateHealthData(...healthyNode(), row(true, JSON.stringify(details)));
    assert.equal(res.health, true);
    assert.equal(res.healthStatus, 'HEALTHY');
    assert.equal(res.healthData.jsonRpc.health, true);
    assert.equal(res.healthData.jsonRpc.blockNumber, 1234);
    assert.equal(res.healthData.jsonRpc.url, 'http://node:8545/');
  });

  it('JSON-RPC enabled and down - UNHEALTHY with an issue', function () {
    const details = { enabled: true, url: 'http://node:8545/', error: 'connect ECONNREFUSED', consecutiveFailures: 3 };
    const res = utils.consolidateHealthData(...healthyNode(), row(false, JSON.stringify(details)));
    assert.equal(res.health, false);
    assert.equal(res.healthStatus, 'UNHEALTHY');
    assert.equal(res.healthIssues.length, 1);
    assert.include(res.healthIssues[0], 'JSON-RPC service (ethereum-jsonrpc) is down');
    assert.include(res.healthIssues[0], 'ECONNREFUSED');
    assert.equal(res.healthData.jsonRpc.health, false);
    assert.equal(res.healthData.jsonRpc.consecutiveFailures, 3);
  });

  it('checkJsonRpc is a no-op when the node runs without --jsonrpc', async function () {
    // JSONRPC_ENABLED is not set in the test environment
    const [isUp, details] = await nodeHealthCheckJs.checkJsonRpc();
    assert.equal(isUp, true);
    assert.equal(details.enabled, false);
  });
});
