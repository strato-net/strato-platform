"use strict";
const ba = require('blockapps-rest');
const co = require('co');
const config = ba.common.config;
const rest = ba.rest6;
const assert = ba.common.assert;
const util = ba.common.util;
const BigNumber = ba.common.BigNumber;
config.apiDebug=true;
const nonceOrder = `
contract NonceOrder {
    uint a = 0;
    uint b = 0;

    constructor(uint _x) {
      a = _x;
    }

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

async function createNewUser(fill) {
  const username = 'NonceOrder_User_' + util.uid();
  const password = '23456';
  const user = await co.wrap(rest.createUser)(username, password, true);
  if (fill) {
    await co.wrap(rest.fill)(user, true);
  }
  return user;
}


async function upload() {
  const user = await createNewUser(true);
  const args = {_x: 0};
  console.log(`User ${user.name}@${user.address} uploading a NonceOrder`);
  return [user, await co.wrap(rest.uploadContractString)(user, 'NonceOrder', nonceOrder, args)];
}

async function send(user, address, xs) {
  let { nonce } = await co.wrap(rest.getNonce)(user);
  nonce += xs.length;
  // Set nonces in reverse list order
  const txs = xs.map(x => {
    nonce--;
    console.log(`nonce is ${nonce}`);
    return {
      toAddress: address,
      value: x,
      txParams: { nonce }
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await co.wrap(rest.sendList)(user, txs);
}

async function sendNoNonces(user, address, xs) {
  const txs = xs.map(x => {
    return {
      toAddress: address,
      value: x
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await co.wrap(rest.sendList)(user, txs);
}

async function create(user, contract, xs) {
  let { nonce } = await co.wrap(rest.getNonce)(user);
  nonce += xs.length;
  // Set nonces in reverse list order
  const txs = xs.map(x => {
    nonce--;
    console.log(`nonce is ${nonce}`);
    return {
      contractName: contract,
      value: 0,
      txParams: { nonce },
      args: {_x: x}
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await co.wrap(rest.uploadContractList)(user, txs);
}

async function createNoNonces(user, contract, xs) {
  const txs = xs.map(x => {
    return {
      contractName: contract,
      value: 0,
      args: {_x: x}
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await co.wrap(rest.uploadContractList)(user, txs);
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

  it ('will respect the nonce provided on each send tx', async () => {
    const user = await createNewUser(true);
    console.log(`Setting 300, then 4`);
    const user2 = await createNewUser(false);
    await send(user, user2.address, [4, 300]);
    const result = await co.wrap(rest.getBalance)(user2.address);
    assert.deepEqual(result, new BigNumber(304));
  }).timeout(config.timeout);

  it ("won't collide nonces when none are provided for send txs", async () => {
    const user = await createNewUser(true);
    console.log(`Setting 4, then 300`);
    const user2 = await createNewUser(false);
    await sendNoNonces(user, user2.address, [4, 300]);
    const result = await co.wrap(rest.getBalance)(user2.address);
    assert.deepEqual(result, new BigNumber(304));
  }).timeout(config.timeout);

  it ('will respect the nonce provided on each contract tx', async () => {
    const user = await createNewUser(true);
    console.log(`Setting 300, then 4`);
    const contracts = await create(user, 'NonceOrder', [4, 300]);
    console.log(`Checking our work`);
    let results = await get(user, contracts[0]);
    assert.deepEqual(results, ["4", "0"]);
    results = await get(user, contracts[1]);
    assert.deepEqual(results, ["300", "0"]);
  }).timeout(config.timeout);

  it ("won't collide nonces when none are provided for contract txs", async () => {
    const user = await createNewUser(true);
    console.log(`Setting 4, then 300`);
    const contracts = await createNoNonces(user, 'NonceOrder', [4, 300]);
    console.log(`Checking our work`);
    let results = await get(user, contracts[0]);
    assert.deepEqual(results, ["4", "0"]);
    results = await get(user, contracts[1]);
    assert.deepEqual(results, ["300", "0"]);
  }).timeout(config.timeout);

  it ('will respect the nonce provided on each method tx', async () => {
    const [user, contract] = await upload();
    console.log(`Setting 300, then 4`);
    await set(user, contract, [4, 300]);
    console.log(`Checking our work`);
    const results = await get(user, contract);
    assert.deepEqual(results, ["300", "4"]);
  }).timeout(config.timeout);

  it ("won't collide nonces when none are provided for method txs", async () => {
    const [user, contract] = await upload();
    console.log(`Setting 4, then 300`);
    await setNoNonces(user, contract, [4, 300]);
    console.log(`Checking our work`);
    const results = await get(user, contract);
    assert.deepEqual(results, ["4", "300"]);
  }).timeout(config.timeout);
})
