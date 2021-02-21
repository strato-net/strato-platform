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

const ErrorCodes = rest.getEnums(path.join(config.contractsPath, "ErrorCodes.sol")).ErrorCodes;
const titleManagerJs = require(`../load/titleManager`);
const contractName = 'Title';

const adminName = util.uid('Admin');
const adminPassword = '1234';

describe('LOAD TEST: Call List', function() {
  this.timeout(999999 * 1000);

  let admin, contract;
  const batchSize = util.getArgInt('--batchSize', 3);
  const batchCount = util.getArgInt('--batchCount', 1);
  const isStateCheck = util.getArgInt('--state', 0) ? true : false;

  before(function*() {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(admin);
    contract = yield titleManagerJs.uploadContract(admin);
    console.log(contract);
  });

  it(`Call a method that creates a contract: Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    const uid = util.uid();

    console.log(`Call a method that creates a contract: Batch size: ${batchSize}, Batch count ${batchCount}`);
    const startTime = moment();
    for (var i = 0; i < batchCount; i++) {
      console.log( 'batch ' + i);
      const txs = yield createTxsBatch(admin, contract, uid, i, batchSize);
      // function* callList(user, txs, doNotResolve, node)
      const results = yield rest.callList(admin, txs);
      assert.equal(results.length, batchSize, 'all created');
      const errors = getErrors(results);
      assert.equal(errors.length, 0, 'no errors:' + JSON.stringify(errors));
      if (isStateCheck) {
        const state = yield contract.getState();
        const total = (i+1) * batchSize;
        assert.equal(state.titles.length-1, total, 'all created');
        for (var t = 1; t < state.titles.length; t++) {
          if (state.titles[t] == 0) {
            console.log(`curl -i http://localhost/cirrus/search/TitleManager?address=eq.${contract.address}`);
            console.log(`curl -i http://localhost/bloc/v2.2/contracts/TitleManager/${contract.address}/state`);
            assert(false, 'Not an address: ' + t + ' ' + state.titles[t]);
          }
          assert.isOk(util.isAddress(state.titles[t]), 'Not an address: ' + t + ' ' + state.titles[t]);
        }
      }
    }
    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Batch count: ${batchCount}  Batch size: ${batchSize}`);
    console.log(`Total:  seconds: ${seconds}  txs: ${batchCount*batchSize}  TPS ${(batchCount*batchSize)/seconds}`);
  });

  function getErrors(results) {
    return results.filter(result => {
      return result[0] != ErrorCodes.SUCCESS;
    })
  }

  function* createTxsBatch(admin, contract, uid, batchNumber, batchSize) {
    const txs = [];
    const offset = batchNumber * batchSize;
    const acct = yield rest.getAccount(admin.address);
    for(var i=0; i < batchSize; i++) {
      const tx = {
        'contractName': contract.name,
        'contractAddress': contract.address,
        'methodName': 'createTitle',
        'value': 0,
        'args': {
          _vin: `Vin_${uid}_${offset}_${i}`,
        },
	'txParams': { nonce: acct[0].nonce }
      }
      txs.push(tx);
    }
    return txs;
  }
});

function* call(admin, contract, method, args) {
  rest.verbose('call', method, args);
  const result = yield rest.callMethod(admin, contract, method, args);
  return result;
}
