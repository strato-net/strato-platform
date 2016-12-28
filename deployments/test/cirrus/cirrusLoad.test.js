const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const api = common.api;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = require('bignumber.js');
const Promise = common.Promise;
const txFactory = require('./transaction.factory.js');

describe('Cirrus - Load Test', function() {
  this.timeout(120 * 1000);

  const scope = { batchResultCount: 0};
  const adminName = util.uid('Admin');
  const adminPassword = config.password;
  const contractName = 'SampleManager';
  const contractFilename = './fixtures/search/SampleManager.sol';

  const compileList = [{
    searchable: ['Sample'],
    contractName: contractName,
  }];

  const contractList = [{
    contractName: contractName,
    args: {},
    txParams: api.getTxParams(),
  }];

  // do once
  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(adminName, adminPassword))
      .then(rest.getContractString(contractName, contractFilename))
      .then(rest.uploadContract(adminName, adminPassword, contractName, {startIndex:1} ))
      .then(rest.compile(compileList))
      .then(function(scope) {
        done();
      })
      .catch(done);
  });

  it('Should upload batches', function(done) {
    const batchSize = 100;
    const batchCount = 2;
    const batchDelay = 15 * 1000;
    const uid = util.uid();

    const batches = [...Array(batchCount).keys()];
    Promise.each(batches, function(batch) {
      return processBatch(batch, batchSize, uid)(scope)
        .then(util.delayPromise(batchDelay))// wait for cirrus to catch up
        .then(processBatchResult(batch, batchSize, uid)) // process each batch results
        .then(util.delayPromise(3000));// wait for query to finish
      })
      .then(function() {
        // process all results
        assert.equal(scope.batchResultCount, batches.length * batchSize, "Cirrus should return the same number of records");
        done();
      })
      .catch(done);
  });

  function processBatchResult(batch, batchSize, uid) {
    return function(scope) {
      console.log('Query', 'Sample?currentVendor=eq.currentvendor' + batch + '&currentLocationType=eq.' + uid);
      rest.query('Sample?currentVendor=eq.currentvendor' + batch + '&currentLocationType=eq.' + uid)(scope)
        .then(function(scope){
          var result = scope.query.slice(-1)[0];
          console.log("Returned", result.length, "results");
          scope.batchResultCount += result.length;
          return scope;
        });
    }
  }

  function processBatch(batch, batchSize, uid) {
    return function(scope) {
      const txs = txFactory.getTxs(
        contractName,
        scope.contracts[contractName].address,
        'add', //methodname
        0, //value
        batch,
        batchSize,
        uid,
        txFactory.getSampleVersion1);
      const resolve = true;
      return rest.callMethodList(adminName, txs, resolve)(scope);
     }
  }

});
