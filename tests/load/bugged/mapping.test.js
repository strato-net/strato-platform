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

const titleManagerJs = require(`./titleManager`);
const adminName = util.uid('Admin');
const adminPassword = '1234';

describe('LOAD TEST: mapping', function() {
  this.timeout(999999 * 1000);

  let admin, contract;
  const batchSize = util.getArgInt('--batchSize', 3);
  const batchCount = util.getArgInt('--batchCount', 1);

  before(function*() {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(admin);
    contract = yield titleManagerJs.uploadContract(admin);
    console.log(contract);
  });

  it(`Call a method that fills up an mapping: Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    for (var batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      const args = {batchSize: batchSize, batchIndex: batchIndex};
      const method = 'testMapping';
      const result = yield call(admin, contract, method, args);
      const actualHex = result[0];
      const actual = parseInt(actualHex, 16);
      const expected = (batchIndex+1)*batchSize-1; // the last value of this batch
      assert.equal(actual, expected, `${batchIndex}`);
      console.log('mapped total:', (batchIndex+1)*batchSize, 'last value:', result);
    }
  });

});

function* call(admin, contract, method, args) {
  rest.verbose('call', method, args);
  const result = yield rest.callMethod(admin, contract, method, args);
  return result;
}
