"use strict";
const ba = require('blockapps-rest');
const co = require('co');
const config = ba.common.config;
const rest = ba.rest6;
const assert = ba.common.assert;
const util = ba.common.util;
config.apiDebug=true;
const nonceOrder = `
contract NonceOrder {
    uint a = 0;
    uint b = 0;

    function set(uint _x) public {
      if (a == 0) {
        a = _x;
        return;
      }
      b = _x;
    }

    function get() public returns (uint, uint) {
      return (a, b);
    }
}
`;


async function upload() {
  const username = 'NonceOrder_User_' + util.uid();
  const password = '23456';
  const user = await co.wrap(rest.createUser)(username, password);
  await co.wrap(rest.fill)(user, true);
  console.log(`User ${user.name}@${user.address} uploading a NonceOrder`);
  return [user, await co.wrap(rest.uploadContractString)(user, 'NonceOrder', nonceOrder)];
}

async function set(user, contract, xs) {
  let { nonce } = await co.wrap(rest.getNonce)(user);
  nonce += xs.length;
  // Set nonces in reverse list order
  const txs = xs.map(x => {
    nonce--;
    console.log(`nonce is ${nonce}`);
    return {
      contractName: contract.name,
      contractAddress: contract.address,
      methodName: 'set',
      value: 0,
      args: {'_x': x},
      txParams: { nonce }
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await co.wrap(rest.callList)(user, txs);
}

async function setNoNonces(user, contract, xs) {
  const txs = xs.map(x => {
    return {
      contractName: contract.name,
      contractAddress: contract.address,
      methodName: 'set',
      value: 0,
      args: {'_x': x}
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await co.wrap(rest.callList)(user, txs);
}

async function get(user, contract) {
  return await co.wrap(rest.callMethod)(user, contract, "get");
}

describe('Nonce upload orders', async () => {

  it ('will respect the nonce provided on each tx', async () => {
    const [user, contract] = await upload();
    console.log(`Setting 300, then 4`);
    await set(user, contract, [4, 300]);
    console.log(`Checking our work`);
    const results = await get(user, contract);
    assert.deepEqual(results, ["300", "4"]);
  }).timeout(config.timeout);

  it ("won't collide nonces when none are provided", async () => {
    const [user, contract] = await upload();
    console.log(`Setting 4, then 300`);
    await setNoNonces(user, contract, [4, 300]);
    console.log(`Checking our work`);
    const results = await get(user, contract);
    assert.deepEqual(results, ["4", "300"]);
  }).timeout(config.timeout);
})
