const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const assert = common.assert;
const nodes = config.nodes;
const moment = require('moment');
const constants = common.constants;
const path = require('path');

describe('Throughput - fx call', function () {

  this.timeout(config.timeout);
  const contractName = 'SimpleIncrement';
  const contractFilename = path.join(config.contractsPath, 'SimpleIncrement.sol');
  let users;
  let contracts = [];

  const batchSize = util.getArgInt('--batchSize', 1);

  before(function * () {
    users = yield createUsers();
    for(let i = 0; i < users.length; i++) {
      contract = yield rest.uploadContract(users[i], contractName, contractFilename, {}, false, {}, i);
      contracts.push(contract);
    }
  });

  it('should calculate method call throughput for network', function * () {

    const startTime = moment();
    let secondsToRemove = 0; // FIX ME: Remove once bloc is no longer blocking on tx status
    const generators = [];

    for(let node of nodes) {
      const user = users[node.id];
      const txs = createBatchTx(user, contracts[node.id]);
      generators.push(rest.callList(user, txs, true, node.id));
    }

    console.log('Submitting txs');
    const bStartTime = moment();
    yield generators;
    const bEndTime = moment();
    console.log('Submitted txs');

    // secondsToRemove = bEndTime.diff(bStartTime, 'seconds');

    let statesMatch = false;
    let stateCheck = 1;
    while (!statesMatch) {
      console.log(`Checking balances ${stateCheck++}`);
      statesMatch = yield checkStates();
      yield promiseTimeout(300);
    }

    const endTime = moment();
    assert.isOk(statesMatch, "All states should match");
    const seconds = endTime.diff(startTime, 'seconds') - secondsToRemove;
    console.log(`Bloc request seconds (removed): ${secondsToRemove}`);
    console.log(`Total Seconds: ${seconds}`);
    console.log(`Approx TPS: ${(batchSize * nodes.length) / seconds} tx/sec`);
  })

  // HELPER FUNCTIONS FOR TESTS

  /**
   * Create alice for uploads.
   */
  function * createUsers() {
    const users = [];
    const uid = util.uid();
    const password = '1234';
    for (let node of nodes) {
      const aliceName = `Alice_${node.id}_${uid}`;
      console.log(`Creating user ${aliceName} on node ${node.id}`);
      const alice = yield rest.createUser(aliceName, password, false, node.id);
      users.push(alice);
    }
    console.log('DONE creating users');
    return users;
  }

  function promiseTimeout(timeout) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        resolve();
      }, timeout);
    });
  }

  function * checkStates() {
    let stateMatches = true;
    for (let node of nodes) {
      state = yield rest.getState(contracts[node.id]);
      stateMatches &= (state.x == batchSize);
      if(!stateMatches)  {
        break;
      }
    }
    return stateMatches;
  }

  function createBatchTx(fromUser, contract) {
    var txs = [];

    for (var i = 0; i < batchSize; i++) {
      txs.push({
        contractAddress: contract.address,
        contractName: contract.name,
        args: {},
        value: 0,
        methodName: 'increment'
      });
    }
    return txs;
  }

});
