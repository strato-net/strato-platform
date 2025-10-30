const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const BigNumber = common.BigNumber;
const assert = common.assert;
const nodes = config.nodes;
const moment = require('moment');
const constants = common.constants;

describe('Throughput - send', function () {

  this.timeout(config.timeout);

  let userPairs;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchValue = util.getArgInt('--batchValue', 8);

  before(function * () {
    userPairs = yield createUserPairs();
  });

  it('should calculate send throughput for network', function * () {

    const startTime = moment();
    let secondsToRemove = 0; // FIX ME: Remove once bloc is no longer blocking on tx status
    const generators = [];

    for(let node of nodes) {
      const txs = createBatchTx(userPairs[node.id].bob);
      generators.push(rest.sendList(userPairs[node.id].alice, txs, true, node.id));
    }

    console.log('Submitting txs');
    const bStartTime = moment();
    yield generators;
    const bEndTime = moment();
    console.log('Submitted txs');

    // secondsToRemove = bEndTime.diff(bStartTime, 'seconds');

    let balancesMatch = false;
    let balanceCheck = 1;
    while (!balancesMatch) {
      console.log(`Checking balances ${balanceCheck++}`);
      balancesMatch = yield checkBalances(userPairs);
      yield promiseTimeout(300);
    }

    const endTime = moment();
    assert.isOk(balancesMatch, "All balances should match");
    const seconds = endTime.diff(startTime, 'seconds') - secondsToRemove;
    console.log(`Bloc request seconds (removed): ${secondsToRemove}`);
    console.log(`Total Seconds: ${seconds}`);
    console.log(`Approx TPS: ${(batchSize * nodes.length) / seconds} tx/sec`);
  })

  // HELPER FUNCTIONS FOR TESTS

  /**
   * Create Alice and Bob aynschronously for each node. Faucet Alice.
   */
  function * createUserPairs() {
    const userPairs = [];
    const uid = util.uid();
    const password = '1234';
    for (let node of nodes) {
      const aliceName = `Alice_${node.id}_${uid}`;
      console.log(`Creating user ${aliceName} on node ${node.id}`);
      const alice = yield rest.createUser(aliceName, password, false, node.id);
      const bobName = `Bob_${node.id}_${uid}`;
      console.log(`Creating user ${bobName} on node ${node.id}`);
      const bob = yield rest.createUser(bobName, password, true, node.id);
      userPairs.push({alice: alice, bob: bob});
    }
    console.log('DONE creating users');
    return userPairs;
  }

  function promiseTimeout(timeout) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        resolve();
      }, timeout);
    });
  }

  function * checkBalances(userPairs) {
    const expectedBalance = new BigNumber(batchValue * batchSize)
      .times(constants.ETHER);
    const promises = [];
    for (let node of nodes) {
      const alice = userPairs[node.id].alice;
      const bob = userPairs[node.id].bob;
      promises.push(co(rest.getBalance(bob.address, 0, node.id)));
    }
    responses = yield Promise.all(promises);
    return responses.reduce((check, response) => {
      return check && response.comparedTo(expectedBalance) == 0
    }, true);
  }

  function createBatchTx(toUser) {
    var txs = [];
    weiValue = new BigNumber(batchValue).times(constants.ETHER).toNumber();
    for (var i = 0; i < batchSize; i++) {
      txs.push({
        value: weiValue,
        toAddress: toUser.address
      });
    }
    return txs;
  }

});
