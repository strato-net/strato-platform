const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const assert = common.assert;

const source = `
pragma solidity ^0.4.24;

contract Random {
  bytes32 value;

  constructor() {
    value = blockhash(block.number - 1);
  }
}
`;

describe('Using blockhash', function () {
  it('should upload a contract that uses blockhash', async () => {
    const username = 'random_' + util.uid();
    const admin = await co.wrap(rest.createUser)(username, '1234');
    const contract = await co.wrap(rest.uploadContractString)(admin, 'Random', source);
    const state = await co.wrap(rest.getStateVar)(contract,'value');
    console.log(`Random state: ${JSON.stringify(state, null, 2)}`);
    assert.notEqual(state.value, 0, "Variable value did not match expected state");
  }).timeout(config.timeout);
});
