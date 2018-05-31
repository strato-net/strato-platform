const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const api = common.api;
const config = common.config;
const util = common.util;
const assert = common.assert;
const nodes = config.nodes;
const moment = require('moment');
const constants = common.constants;
const path = require('path');

describe('Throughput - upload', function () {

  this.timeout(config.timeout);
  const contractName = 'SimpleStorage';
  const contractFilename = path.join(config.contractsPath, 'SimpleStorage.sol');
  let users;
  let contracts = [];
  let txs = []

  before(function * () {
    users = yield createUsers();
    for(let i = 0; i < users.length; i++) {
      yield rest.compileSearch([contractName], contractName, contractFilename, i);
    }
    for (var i = 0; i < config.batchSize; i++) {
      txs.push({
        contractName: contractName,
        args: {},
      });
    }
  });

  it('should calculate contract upload throughput for network', function * () {

    const startTime = moment();
    const generators = [];

    for(let node of nodes) {
      const user = users[node.id];    
      generators.push(rest.uploadContractList(user, txs, true, node.id));
    }

    console.log('Submitting txs');
    const bStartTime = moment();
    yield generators;
    const bEndTime = moment();
    console.log('Submitted txs');


    let countMatch = false;
    let countCheck = 1;
    while (!countMatch) {
      console.log(`Checking count ${countCheck++}`);
      countMatch = yield checkCounts();
      yield promiseTimeout(300);
    }

    const secondsToRemove = 0; // bEndTime.diff(bStartTime, 'seconds');

    const endTime = moment();
    assert.isOk(countMatch, "All counts should match");
    const seconds = endTime.diff(startTime, 'seconds') - secondsToRemove;
    console.log(`Bloc request seconds (removed): ${secondsToRemove}`);
    console.log(`Total Seconds: ${seconds}`);
    console.log(`Approx TPS: ${(config.batchSize * nodes.length) / seconds} tx/sec`);
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

  function * checkCounts(userPairs) {
    const promises = [];
    for (let node of nodes) {
      promises.push(co(getContractCount(users[node.id])));
    }
    const counts = yield Promise.all(promises);
    return counts.reduce((check, count) => {
      return check && count == config.batchSize; 
    }, true);
  }
  

  function * getContractCount(user) {
    const results = yield api.strato.transaction(`from=${user.address}`);
    return results.length;
  }

});

