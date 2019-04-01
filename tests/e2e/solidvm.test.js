"use strict";
const ba = require('blockapps-rest');
const chai = require('chai');
const assert = chai.assert
const co = require('co');
require('co-mocha');
const config = ba.common.config;
config.apiDebug = true
console.log(`Config is ${JSON.stringify(config)}`);
const rest = ba.rest6;
const strato = ba.common.api.strato;
const util = ba.common.util;

const counter = `
contract Counter {
    uint count;

    function incr() public {
        count++;
    }
    function read() public view returns (uint) {
        return count;
    }
}
`;

const partialModify = `
contract PartialModify {
  uint x = 83;
  uint y = 72;

  function doubleY() public {
    y *= 2;
  }
}
`;

async function upload(vm, name, source) {
  const username = 'Solidvm_User_' + util.uid();
  const password = '2345';
  const user = await co.wrap(rest.createUser)(username, password);
  await co.wrap(rest.fill)(user, true);
  console.log(`User ${user.name}@${user.address} uploading a ${name} to the ${vm}`);
  return [user, await co.wrap(rest.uploadContractString)(
    user, name, source, {}, {'VM': vm})];
}

async function incr(user, contract, vm) {
  return await co.wrap(rest.callMethod)(
    user, contract, "incr", {}, {'VM': vm});
}

async function read(user, contract, vm) {
  return await co.wrap(rest.callMethod)(
    user, contract, "read", {}, {'VM': vm});
}

async function doubleY(user, contract, vm) {
  return await co.wrap(rest.callMethod)(
    user, contract, "doubleY", {}, {'VM': vm})
}

async function state(contract) {
  return await co.wrap(rest.getState)(contract);
}

async function index(contract) {
  return await co.wrap(rest.query)(`${contract.name}?address=eq.${contract.address}`);
}

describe('Solid VM: Contract uploads', async () => {

  it ('can count upwards on the SolidVM counter', async () => {
    const [user, contract] = await upload('SolidVM', 'Counter', counter);
    console.log(`Contract is : ${JSON.stringify(contract)}`);
    console.log(`Counting to 5`);
    for (let i = 0; i < 5; i++) {
      await incr(user, contract, 'SolidVM');
    }

    console.log('Transacting to read state');
    const gotRead = await read(user, contract, 'SolidVM');
    assert.deepEqual(gotRead, ["5"]);

    console.log('Reading state from bloch');
    const gotState = await state(contract);
    assert.equal(gotState.count, '5');

    console.log('Reading state from cirrus');
    const gotIndex = await index(contract);
    assert.equal(gotIndex[0].address, contract.address);
    assert.equal(gotIndex[0].count, 5);
  }).timeout(config.timeout);

  it ('does not drop columns', async () => {
    const [user, contract] = await upload('SolidVM', 'PartialModify', partialModify);
    console.log(`Contract is ${JSON.stringify(contract)}`);


    const index1 = await co.wrap(rest.waitQuery)(
      `${contract.name}?address=eq.${contract.address}`, 1);
    console.log(`First index response is: ${JSON.stringify(index1)}`);
    assert.equal(index1[0].address, contract.address);
    assert.equal(index1[0].x, 83);
    assert.equal(index1[0].y, 72);

    await doubleY(user, contract, 'SolidVM');

    const index2 = await co.wrap(rest.waitQuery)(
      `${contract.name}?address=eq.${contract.address}&y=eq.144`, 1);
    assert.equal(index2[0].address, contract.address);
    assert.equal(index2[0].x, 83);
    assert.equal(index2[0].y, 144);
  }).timeout(config.timeout);
})
