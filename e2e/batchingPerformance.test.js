const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = require('bignumber.js');
const Promise = common.Promise;

function api_getTxParams() {
  return {
    gasLimit: 100000000,
    gasPrice: 1
  };
}

// create a delay, before a promise. pass in args payload
function DelayPromise(delay) {
  return function(scope) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        resolve(scope);
      }, delay);
    });
  }
}

describe('Bloc - Batch TPS', function() {
  this.timeout(240 * 1000);

  const scope = { timings: [] };
  const adminName = util.uid('Admin');
  const adminPassword = '1234';
  const contractName = 'SampleManager';
  const contractFilename = './fixtures/search/SampleManager.sol';

  const compileList = [{
    searchable: ['Sample'],
    contractName: contractName,
  }];

  const contractList = [{
    contractName: contractName,
    args: {},
    txParams: api_getTxParams(),
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
    const batchCount = 20;
    const batchDelay = 5 * 1000;
    const uid = util.uid();

    const batches = [...Array(batchCount).keys()];
    Promise.each(batches, function(batch) {
      return processBatch(batch, batchSize, uid)(scope)
        .then(DelayPromise(batchDelay));// wait for query to finish
      })
      .then(function() {
        // process all results
        var avg = scope.timings.reduce(function(a,b) {
          return a+b;
        }, 0) / scope.timings.length ;
        var tps = batchSize / avg;
        console.log("TPS is ", tps);
        assert.isAtLeast(tps, 15, "Batch TPS should be atleast 15");
        done();
      }).catch(done);
  });

  function processBatch(batch, batchSize, uid) {
    return function(scope) {
      const txs = createBatchTx(batch, batchSize, uid);
      const resolve = true;
      var timeStart = new Date();
      return rest.callMethodList(adminName, txs, resolve)(scope)
        .then(function(scope){
          var timeEnd = new Date();
          scope.timings.push((timeEnd.getTime() - timeStart.getTime()) / 1000);
          console.log(scope.timings);
          return scope;
        });
     }
  }

  function createBatchTx(batch, batchSize, uid) {
    var txs = [];
    for (var i = 0; i < batchSize; i++) {
      txs.push({
        contractName: contractName,
        contractAddress: scope.contracts[contractName].address,
        methodName: 'add',
        value: 0,
        args: createSample(i, uid, batch),
        txParams: api_getTxParams(),
      });
    }
    return txs;
  }

  function createSample(index, uid, batch) {
    return {
      wellname: 'wellname' + index,
      sampletype: 'sampletype' + index,
      currentlocationtype: uid,
      currentvendor: 'currentvendor' + batch,
      startdepthfeet: index * 100,
      enddepthfeet: index * 110,
      startdepthmeter: index * 100 / 3,
      enddepthmeter: index * 110 / 3,
    };
  }

});
