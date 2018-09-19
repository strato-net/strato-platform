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

describe('Using blockhash', function () {

  this.timeout(config.timeout);
  const contractRandomName = 'Random';
  const contractRandomFilename = path.join(config.contractsPath, 'Random.sol');
  let admin;
  let contract;

  before(function * () {
    admin = yield rest.createUser('admin','1234');
  });

  it('should upload a contract that uses blockhash', function * () {
    contract = yield rest.uploadContract(admin, contractRandomName, contractRandomFilename, {}, false);
    const state = yield rest.getStateVar(contract,'value');
    assert.notEqual(state.value, 0, "Variable value did not match expected state");
  })
});
