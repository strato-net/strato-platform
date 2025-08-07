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

  before(function * () {
    users = yield createUsers();
    for(let i = 0; i < users.length; i++) {
      yield rest.compileSearch([contractName], contractName, contractFilename, i);
    }
  });

  it('should calculate contract upload throughput for network', function * () {
    for(var k = 0; k < 1000; k++) {
	    const startTime = moment();
	    const generators = [];

	    for(let node of nodes) {
	      const user = users[node.id];
	      const txs = createBatchTx();
	      generators.push(rest.uploadContractList(user, txs, true, node.id));
	    }

	    //console.log('Submitting txs');
	    const bStartTime = moment();
	    yield generators;
	    const bEndTime = moment();
	    //console.log('Submitted txs');


	    let countMatch = false;
	    let countCheck = 1;
	    while (!countMatch) {
	      countMatch = true;
	      for(let node of nodes) {
		const numContracts = yield getContractCount(users[node.id], node);
		countMatch = countMatch && (numContracts == (k+1)*config.batchSize);
	      }
	      yield promiseTimeout(1000);
	    }

	    const endTime = moment();
	    assert.isOk(countMatch, "All counts should match");
	    const seconds = endTime.diff(startTime, 'seconds');
	    const seconds2 = endTime.diff(bEndTime, 'seconds');
	    const numTxs = config.batchSize * nodes.length;
	    console.log(`${numTxs/seconds2},${numTxs/seconds}`);
    }
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

  function createBatchTx() {
    var txs = [];

    for (var i = 0; i < config.batchSize; i++) {
      txs.push({
        contractName: contractName,
        args: {},
      });
    }
    return txs;
  }

  function promiseTimeout(timeout) {
    return new Promise(function(resolve, reject) {
      setTimeout(function() {
        resolve();
      }, timeout);
    });
  }

  function * checkBalances(userPairs) {
    const promises = [];
    for (let node of nodes) {
      promises.push(co(getContractCount(users[node.id])));
    }
    const counts = yield Promise.all(promises);
    return counts.reduce((check, count) => {
      return check && count == config.batchSize;
    }, true);
  }


  function * getContractCount(user, node) {
    const results = yield api.strato.transaction(`from=${user.address}`, node.id);
    return results.length;
  }

});

