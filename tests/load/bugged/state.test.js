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

describe('LOAD TEST: state', function() {
  this.timeout(999999 * 1000);

  let admin, contract;
  const batchSize = util.getArgInt('--batchSize', 80);
  const batchCount = util.getArgInt('--batchCount', 30);
  const readState = util.getArgInt('--readState', 0);

  before(function*() {
    console.log(`Creating admin user and contract`);
    admin = yield rest.createUser(adminName, adminPassword);
    console.log(admin);
    contract = yield titleManagerJs.uploadContract(admin);
    console.log(contract);
  });

  it(`Call a method that fills up an array: Batch size: ${batchSize}, Batch count ${batchCount}`, function * () {
    for (var i = 0; i < batchCount; i++) {
      const args = {count: batchSize};
      const method = 'testState';
      const results = yield call(admin, contract, method, args);
      console.log(results);
      const [length, value] = results;
      const total = (i+1) * batchSize;
      assert.equal(length-1, total, 'pushed');
      assert.equal(parseInt(value, 16), total, 'value');
      if (readState) {
        const state = yield rest.getStateVar(contract, 'titles', null, null, true);
        assert.equal(state.titles - 1, total, 'all created');
      }
    }
  });


});

function* call(admin, contract, method, args) {
  rest.verbose('call', method, args);
  const result = yield rest.callMethod(admin, contract, method, args);
  return result;
}
