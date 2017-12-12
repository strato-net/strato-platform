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

describe('Throughput', function () {

  this.timeout(config.timeout);

  let userPairs;

  before(function * () {
    userPairs = yield createUserPairs();
  });

  it('should calculate throughput for network', function * () {
    const count = 20; // number of faucets for each account
    const startTime = moment();
    let numberOfFaucets = 0;
    for (let i = 0; i < count; i++) {
      for (let node of nodes) {
        yield rest.fill(userPairs[node.id].alice, false, node.id);
        yield rest.fill(userPairs[node.id].bob, false, node.id);        
        numberOfFaucets+=2;
      }
    }

    let balancesMatch = false;
    let balanceCheck = 1;
    while (!balancesMatch) {
      console.log(`Checking balances ${balanceCheck++}`);
      balancesMatch = yield checkBalances(userPairs, count);
    }

    const endTime = moment();
    assert.isOk(balancesMatch, "All balances should match");
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Approx TPS: ${numberOfFaucets / seconds} tx/sec`);
  })

  // HELPER FUNCTIONS FOR TESTS

  /**
   * Create Alice and Bob aynschronously for each node
   */
  function * createUserPairs() {
    const userPairs = [];
    const uid = util.uid();
    const password = '1234';
    for (let node of nodes) {
      const aliceName = `Alice_${node.id}_${uid}`;
      const alice = yield rest.createUser(aliceName, password, true, node.id);
      console.log(alice);
      const bobName = `Bob_${node.id}_${uid}`;
      const bob = yield rest.createUser(bobName, password, true, node.id);
      console.log(bob);
      userPairs.push({alice: alice, bob: bob});
    }
    console.log('DONE creating users');
    return userPairs;
  }

  function * checkBalances(userPairs, count) {
    const expectedBalance = new BigNumber(1000).times(constants.ETHER * count);
    const promises = [];
    for (let node of nodes) {
      const alice = userPairs[node.id].alice;
      const bob = userPairs[node.id].bob;

      promises.push(co(rest.getBalance(alice.address, 0, node.id)));
    }
    responses = yield Promise.all(promises);
    return responses.reduce((check, response) => {
      return check && response.comparedTo(expectedBalance) == 0
    }, true);
  }

});

