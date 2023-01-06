/* Unused code notice. Node stats disabled, to be deprecated  #node-stats-deprecation
slash-asterisk jshint esnext: true asterisk-slash
const assert = require('chai').assert;
const nock = require('nock');
const { posix } = require('path');


process.env.STATS_DEBUG_CUSTOM_SERVER_URL = 'https://mocked.blockapps.stat.server' //should go before we require config and statsUtils
const config = require('../config/app.config');
const models = require('../models');
const statsUtils = require('../daemons/node-stats-utils');


process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const timeout = 15 * 1000;
const defaultProcessEnv = process.env

describe('Tests - Usage statistics', async function () {
  this.timeout(timeout);
  const statsDaemon = new statsUtils.StatsDaemon()
  before(async function () {
    await statsDaemon.init()
  })
  afterEach(async function () {
    process.env = defaultProcessEnv
    nock.cleanAll()
  })

  
  it('Usage stats are being created', async function () {
    const stat1 = await models.UsageStat.findOne({
      order: [['createdAt', 'DESC']],
    })
    //stat == null OR model obj here
    const stat1Id = stat1 ? stat1.id : 0
    await statsDaemon.collectStats()
    const stat2 = await models.UsageStat.findOne({
      order: [['createdAt', 'DESC']],
    })
    const stat2Id = stat2 ? stat2.id : -1
    assert.equal(stat2Id, stat1Id + 1, 'last UsageStat\'s id is expected to increment exactly by 1 after .collectStats() is executed')
  })

  it('Usage stats are created with proper data', async function () {
    const stat1 = await models.UsageStat.findOne({
      order: [['createdAt', 'DESC']],
    })
    let hasAllExpectedProps = true
    const listOfDataValues = [
      'id',
      'networkTxs',
      'networkTxsTotal',
      'contractTypesAdded',
      'contractTypesTotal',
      'contractCountsByType',
      'contractFieldsAdded',
      'contractFieldsTotal',
      'usersAdded',
      'usersTotal',
      'apiReads',
      'apiReadsTotal',
      'apiWrites',
      'apiWritesTotal',
      'periodSec',
      'timestamp',
      'submitted',
      'createdAt',
      'updatedAt',
    ]
    for (const propName of listOfDataValues) {
      const prop = stat1.dataValues[propName]
      if (typeof prop === 'undefined' || prop === null) {
        hasAllExpectedProps = false
      }
    }
    assert.equal(hasAllExpectedProps, true, 'Created UsageStat must have all expected data values')
    assert.equal(stat1.submitted, false, 'The created UsageStat is expected to be unsubmitted')
    assert.isObject(stat1.contractCountsByType, 'contractCountsByType of UsageStat is expected to always be object')

  })
  
  it('Usage stats are being submitted', async function () {
    nock(process.env.STATS_DEBUG_CUSTOM_SERVER_URL)
        .persist()
        .post(posix.join(config.statistics.blockappsStatServerApiPath, 'stats/'))
        .reply(200, {success: true});

    await statsDaemon.collectStats()
    const unsubmittedStats1 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.isAbove(unsubmittedStats1.length, 0, 'At least one stat should be unsubmitted right after one stat was just created')
    await statsDaemon.submitStats()
    const unsubmittedStats2 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.equal(unsubmittedStats2.length, 0, 'There should be NO unsubmitted stats right after we submitted them all')
  })

  it('Failure during the stats submissions makes stats queued for submission in next iteration', async function () {
    nock(process.env.STATS_DEBUG_CUSTOM_SERVER_URL)
        .persist()
        .post(posix.join(config.statistics.blockappsStatServerApiPath, 'stats/'))
        .reply(404, {success: true});
    
    await statsDaemon.collectStats()
    const unsubmittedStats1 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.isAbove(unsubmittedStats1.length, 0, 'At least one stat should be unsubmitted right after one stat was just created')

    await statsDaemon.submitStats()
    const unsubmittedStats2 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.equal(unsubmittedStats1.length, unsubmittedStats2.length, 'Number of unsubmitted stats should not change if statserver couldn not be reached')
  })
  
  
  it('Usage stats do not include contract types if STATS_SUBMIT_CONTRACT_TYPES_ENABLED disabled', async function () {
    nock(process.env.STATS_DEBUG_CUSTOM_SERVER_URL)
        .persist()
        .post(posix.join(config.statistics.blockappsStatServerApiPath, 'stats/'), /"contractCountsByType":null/gi)
        .reply(200, {success: true});
    
    await statsDaemon.collectStats()
    const unsubmittedStats1 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.isAbove(unsubmittedStats1.length, 0, 'At least one stat should be unsubmitted right after one stat was just created')

    process.env.STATS_SUBMIT_CONTRACT_TYPES_ENABLED=false
    await statsDaemon.submitStats()
    const unsubmittedStats2 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.equal(unsubmittedStats2.length, 0, 'The stat was expected to contain the "contractCountsByType":null substring (since STATS_SUBMIT_CONTRACT_TYPES_ENABLED=false) in order to be successfully submitted into mock statserver')
  })

  
  it('Request body has all expected data values when submitting to Statserver', async function () {
    const listOfStatProps = [
      'id',
      'networkTxs',
      'networkTxsTotal',
      'contractTypesAdded',
      'contractTypesTotal',
      'contractCountsByType',
      'contractFieldsAdded',
      'contractFieldsTotal',
      'usersAdded',
      'usersTotal',
      'apiReads',
      'apiReadsTotal',
      'apiWrites',
      'apiWritesTotal',
      'periodSec',
      'timestamp',
      // 'submitted', //never submitted
      // 'createdAt', //never submitted
      // 'updatedAt', //never submitted
    ]
    function validateRequestBody(body) {
      console.log(body)
      if(
          !body.nodeId ||
          !body.nodeId.nodeHost ||
          !body.nodeId.nodeAddress ||
          !body.nodeId.stratoVersion ||
          !body.stats ||
          !body.stats.length
      ) {
        return false
      } else {
        const stat = body.stats[0]
        function has(object, key) {
          return object ? hasOwnProperty.call(object, key) : false;
        }
        const litmusTestArray = listOfStatProps.filter(
            (propName) =>
                has(stat, propName) && 
                (
                    !!stat[propName] || 
                    stat[propName] === 0 ||
                    typeof stat[propName] === 'string' || 
                    (propName === 'contractCountsByType' && (stat[propName] === null || typeof stat[propName] === 'object'))
                )
        )
        return litmusTestArray.length > 0
      }
    }
    nock(process.env.STATS_DEBUG_CUSTOM_SERVER_URL)
        .persist()
        .post(posix.join(config.statistics.blockappsStatServerApiPath, 'stats/'), (body) => validateRequestBody(body))
        .reply(200, {success: true});

    await statsDaemon.collectStats()
    const unsubmittedStats1 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.isAbove(unsubmittedStats1.length, 0, 'At least one stat should be unsubmitted right after one stat was just created')

    process.env.STATS_SUBMIT_CONTRACT_TYPES_ENABLED=true
    await statsDaemon.submitStats()
    const unsubmittedStats2 = await models.UsageStat.findAll({
      where: {submitted: false},
      order: [['id', 'ASC']], // it's default but wanted it to be explicit
    })
    assert.equal(unsubmittedStats2.length, 0, 'The stat was expected to have all expected valid data in order to be successfully submitted into mock statserver')
  })

  xit('contractCountsByType is never an empty object if there is at least contract uploaded to node', async function () {
    //todo upload the SimpleStorage contract to node
    //todo validate that request body has stats=>[LAST_IN_ARRAY]=>contractCountsByType is a non-empty object (has as least one prop)
  })
})
*/
