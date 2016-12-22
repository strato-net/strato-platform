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

describe('Bloc - TX load', function() {
  this.timeout(120 * 1000);

  const scope = {
    batchResultCount: 0
  };
  const adminName = util.uid('Admin');
  const adminPassword = config.password;

  const aliceName = util.uid('Alice');
  const bobName = util.uid('Bob');
  const password = config.password;

  // do once
  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(aliceName, password))
      .then(function(scope) {
        return rest.getBalance(scope.users[aliceName].address)(scope)
      })
      .then(rest.createUser(bobName, password))
      .then(function(scope) {
        return rest.getBalance(scope.users[bobName].address)(scope)
      })
      .then(function(scope) {
        const aliceAddress = scope.users[aliceName].address;
        const bobAddress = scope.users[bobName].address;
        // console.log('Alice', scope.balances[aliceAddress]);
        // console.log('Bob', scope.balances[bobAddress]);
        done();
      })
      .catch(done);
  });

  it('Should upload batches', function(done) {
    // 90, 10, 1
    const batchValue = 0.001;
    const batchSize = 50;
    const batchCount = 5;
    const batchDelay = 0.1 * 1000;
    const uid = util.uid();
    this.timeout( (batchCount * batchDelay) + 150*1000);

    const aliceAddress = scope.users[aliceName].address;
    const bobAddress = scope.users[bobName].address;

    const startTime = new Date();
    // .then(function(scope) {
    //   var endTime = new Date();
    //   var elapsedTime = (endTime.getTime() - startTime.getTime()) / 1000;
    //   console.log('Measured TPS is ', batchSize / elapsedTime);
    //   return scope;
    // })


    const batches = [...Array(batchCount).keys()];
    Promise.each(batches, function(batch) {
        // console.log('-------------------- batch', batch, batchCount);
        const endTime = new Date();
        const elapsedTime = (endTime.getTime() - startTime.getTime());
        const txCount = batchSize*batch;

        const tps = (txCount / elapsedTime) * 1000;
        // console.log( 'count', txCount,'elapsed', elapsedTime, 'delay', batchDelay, 'tps', tps);
        return processBatch(aliceName, bobName, batch, batchSize, batchValue, uid)(scope)
          .then(DelayPromise(batchDelay)) // wait for cirrus to catch up
          .then(rest.getBalance(aliceAddress))
          .then(rest.getBalance(bobAddress))
      })
      .then(function() {
        // process all results
        const bobStart = new BigNumber(scope.balances[bobAddress][0]);
        const bobEnd = new BigNumber(scope.balances[bobAddress].slice(-1)[0]);
        const bobDelta = bobEnd.minus(bobStart);

        // console.log('Alice', scope.balances[aliceAddress]);
        // console.log('Bob', scope.balances[bobAddress]);
        // console.log('expected', batchSize, batchCount, batchSize*batchCount);
        // console.log('bobDelta', bobDelta.dividedBy(common.constants.ETHER).toString());

        const endTime = new Date();
        const elapsedTime = (endTime.getTime() - startTime.getTime());
        const txCount = batchSize*batchCount;

        const tps = (txCount / elapsedTime) * 1000;
        // console.log( 'count', txCount,'elapsed', elapsedTime, 'delay', batchDelay, 'tps', tps);

        const expectedDelta = new BigNumber(batchSize * batchCount).times(common.constants.ETHER).times(batchValue);
        bobDelta.should.be.bignumber.equal(expectedDelta);
        done();
      }).catch(done);
  });

  function processBatchResult(aliceName, bobName) {
    return function(scope) {
      return scope;
    }
  }

  function processBatch(aliceName, bobName, batch, batchSize, batchValue, uid) {
    return function(scope) {
      const toAddress = scope.users[bobName].address;
      const txs = createBatchTx(batchSize, batchValue, toAddress);
      const resolve = true;
      return rest.sendList(aliceName, txs, true)(scope);
    }
  }

  function createBatchTx(batchSize, batchValue, toAddress) {
    var txs = [];
    for (var i = 0; i < batchSize; i++) {
      txs.push({
        value: batchValue,
        toAddress: toAddress
      });
    }
    return txs;
  }
});
