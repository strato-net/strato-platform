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

describe('State pagination', function () {

  this.timeout(config.timeout);
  const contractArrayName = 'SimpleArray';
  const contractArrayFilename = path.join(config.contractsPath, 'SimpleArray.sol');
  let admin;
  let contract;

  before(function * () {
    admin = yield createUser();
    contract = yield rest.uploadContract(admin, contractArrayName, contractArrayFilename, {}, false);
  });

  it('should get the state of the uint by name', function * () {
    const state = yield rest.getStateVar(contract,'y');
    assert.equal(state.y, 5, "Variable y did not match expected state");
    assert.isUndefined(state.x, "State path returned more data than expected");
  })

  it('should get the state of the array by name', function * () {
    const state = yield rest.getStateVar(contract,'x');
    assert.equal(state.x.length, 10, "Variable x was not the correct length");
    assert.equal(state.x[0], 1, "Variable x was not in the correct state");
    assert.isUndefined(state.y, "State path returned more data than expected");
  })

  it('should get the only the second half of the array by name', function * () {
    const arrLength = 5;
    const arrOffset = 5;
    const state = yield rest.getStateVar(contract,'x', arrLength, arrOffset);
    console.log('State:',state);
    assert.equal(state.x.length, 5, "Variable x was not the correct length");
    assert.equal(state.x[0], 6, "Variable x was not in the correct state");
    assert.isUndefined(state.y, "State path returned more data than expected");
  })

  it('should get the length of the array', function * () {
    const state = yield rest.getStateVar(contract, 'x', null, null);
    assert.equal(state.x.length, 10, "Array length was not returned properly");
    assert.isUndefined(state.y, null, "State path returned more data than expected");
  })

  // HELPER FUNCTIONS FOR TESTS

  /**
   * Create alice for uploads.
   */
  function * createUser() {
    const uid = util.uid();
    const password = '1234';
    const aliceName = `Alice_${uid}`;
    console.log(`Creating user ${aliceName}`);
    const alice = yield rest.createUser(aliceName, password, false);
    return alice;
  }

});
