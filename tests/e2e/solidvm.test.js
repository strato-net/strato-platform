"use strict";
const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');
const config = ba.common.config;
const rest = ba.rest6;
const util = ba.common.util;

const counter = `
contract qq {
    uint count;

    function incr() public {
        count++;
    }
    function read() public view returns (uint) {
        return count;
    }
}
`;


async function upload(vm) {
  const username = 'Solidvm_User_' + util.uid();
  const password = '2345';
  const user = await co.wrap(rest.createUser)(username, password);
  await co.wrap(rest.fill)(user, true);
  console.log(`User ${user.name}@${user.address} uploading a Counter to the ${vm}`);
  return [user, await co.wrap(rest.uploadContractString)(
    user, 'qq', counter, {}, {'VM': vm})];
}

async function incr(user, contract, vm) {
  return await co.wrap(rest.callMethod)(
    user, contract, "incr", {'VM': vm});
}

async function read(user, contract, vm) {
  return await co.wrap(rest.callMethod)(
    user, contract, "read", {'VM': vm});
}

describe('Solid VM: Contract uploads', async () => {
  // it ('can upload an EVM counter', async () => {
  //   const [user, results] = await upload('EVM');
  //   console.log(`${JSON.stringify(results)}`);
  // }).timeout(config.timeout);

  // it ('can upload a SolidVM counter', async () => {
  //   const [user, results] = await upload('SolidVM');
  //   console.log(`${JSON.stringify(results)}`);
  // }).timeout(config.timeout);

  // it ('can count upwards on the EVM counter', async () => {
  //   const [user, contract] = await upload('EVM');
  //   console.log(`Counting to 5`);
  //   for (let i = 0; i < 5; i ++) {
  //     await incr(user, contract, 'EVM');
  //   }
  //   console.log(`Checking our work`);
  //   const results = await read(user, contract, 'EVM');
  //   console.log(`Results: ${JSON.stringify(results)}`);
  // }).timeout(config.timeout);

  it ('can count upwards on the SolidVM counter', async () => {
    const [user, contract] = await upload('SolidVM');
    console.log(`Counting to 5`);
    for (let i = 0; i < 5; i++) {
      await incr(user, contract, 'SolidVM');
    }
    console.log(`Checking our work`);
    const results = await read(user, contract, 'EVM');
    console.log(`Results: ${JSON.stringify(results)}`);
  }).timeout(config.timeout);
})
