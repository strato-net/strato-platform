"use strict";
import * as path from "path";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  ContractDefinition,
  CallArgs,
  SendTx,
  AccessToken
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config, cacheNonce: true}

//config.apiDebug=true;
const nonceOrder = `
contract record NonceOrder {
    uint a = 0;
    uint b = 0;

    constructor(uint _a, uint _b) {
      a = _a;
      b = _b;
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

async function createNewUser(username:string) {
  const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
  const accessToken:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential(username, "1234", "strato-devel");
  const ouser:OAuthUser = {token: accessToken.token.access_token};
  const user:BlockChainUser = await rest.createUser(ouser, options);
  return user;
}


async function upload() {
  const user = await createNewUser("user3");
  const args = {_a: 0, _b: 0};
  console.log(`User ${user.address} uploading a NonceOrder`);
  return [user, await rest.createContract(user, {name: 'NonceOrder', source: nonceOrder, args}, options)];
}

async function send(user, address, xs) {
  let result = await rest.getAccounts(user, {...options, params: {address: user.address}})
  let nonce = 0;
  if (result[0] !== undefined) nonce = result[0].nonce;
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
  return await rest.sendMany(user, txs, options);
}

async function sendNoNonces(user, address, xs) {
  const txs:SendTx[] = xs.map(x => {
    return {
      toAddress: address,
      value: x
    }});
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await rest.sendMany(user, txs, options);
}

async function create(user, nonce, contract, xs) {
  nonce += xs.length;
  // Set nonces in reverse list order
  const txs = xs.map(x => {
    nonce--;
    console.log(`nonce is ${nonce}`);
    let ret:ContractDefinition = {
      name: contract,
      source: nonceOrder,
      txParams: { nonce },
      args: {_a: x, _b: nonce}
    }
    return ret;
    });
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await rest.createContractList(user, txs, {config: {...config, 'VM': 'SolidVM'}});
}

async function createNoNonces(user, contract:string, xs) {
  const txs = xs.map(x => {
    let ret:ContractDefinition = {
      name: contract,
      source: nonceOrder,
      args: {_a: x, _b: x}
    }
    return ret;
    });
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await rest.createContractList(user, txs, {config: {...config, 'VM': 'SolidVM'}});
}

async function set(user, contract, xs) {
  let result = await rest.getAccounts(user, {...options, params: {address: user.address}})
  let nonce = result[0].nonce;
  nonce += xs.length;
  // Set nonces in reverse list order
  const txs = xs.map(x => {
    nonce--;
    console.log(`nonce is ${nonce}`);
    let ret:CallArgs = {
      contract,
      method: 'set',
      value: new BigNumber(0),
      args: {'_x': x},
      txParams: { nonce }
    }
    return ret;
    });
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await rest.callList(user, txs, options);
}

async function setNoNonces(user, contract, xs) {
  const txs = xs.map(x => {
    let ret:CallArgs = {
      contract,
      method: 'set',
      value: new BigNumber(0),
      args: {'_x': x}
    }
    return ret;
    });
  console.log(`Txs: ${JSON.stringify(txs, null, 2)}`);
  return await rest.callList(user, txs, options);
}

async function get(user, contract) {
  return await rest.call(user, {contract, method: "get", args: {}}, options);
}

async function getBalance(user:OAuthUser, address:string) {
  let result = await rest.getAccounts(user, {...options, params: {address}})
  if (result[0] !== undefined) {
     return result[0].balance;
  } else return 0;
}

describe('Nonce upload orders', async () => {

  it ('will respect the nonce provided on each send tx', async () => {
    const user = await createNewUser("user3");
    console.log(`Setting 300, then 4`);
    const user2 = await createNewUser("user4");
    const balance1 = await getBalance(user, user2.address);
    const v1 = 40000000; // These numbers should be higher than any value other tests use
    const v2 = 3000000000;
    await send(user, user2.address, [v1, v2]);
    const balance2 = await getBalance(user, user2.address);
    const actualDiff = new BigNumber(balance2).minus(balance1).toNumber();
    assert.isAtLeast(actualDiff, v1+v2, `Difference in balance should be at least ${v1+v2}`);
  }).timeout(config.timeout);
  
  it ("won't collide nonces when none are provided for send txs", async () => {
    const user = await createNewUser("user3");
    console.log(`Setting 4, then 300`);
    const user2 = await createNewUser("user4");
    const balance1 = await getBalance(user, user2.address);
    const v1 = 40000000; // These numbers should be higher than any value other tests use
    const v2 = 3000000000;
    await sendNoNonces(user, user2.address, [v1, v2]);
    const balance2 = await getBalance(user, user2.address);
    const actualDiff = new BigNumber(balance2).minus(balance1).toNumber();
    assert.isAtLeast(actualDiff, v1+v2, `Difference in balance should be at least ${v1+v2}`);
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

  it ('will respect the nonce provided on each contract tx', async () => {
    const user = await createNewUser("user3");
    console.log(`Setting 300, then 4`);
    let result = await rest.getAccounts(user, {...options, params: {address: user.address}})
    let nonce = result[0].nonce;
    const contracts = await create(user, nonce, 'NonceOrder', [4, 300]);
    console.log(`Checking our work`);
    let results = await get(user, contracts[0]);
    assert.deepEqual(results, ["4", `${nonce+1}`]);
    results = await get(user, contracts[1]);
    assert.deepEqual(results, ["300", `${nonce}`]);
  }).timeout(config.timeout);

  it ("won't collide nonces when none are provided for contract txs", async () => {
    const user = await createNewUser("user3");
    console.log(`Setting 4, then 300`);
    const contracts = await createNoNonces(user, 'NonceOrder', [4, 300]);
    console.log(`Checking our work`);
    let results = await get(user, contracts[0]);
    assert.deepEqual(results, ["4", "4"]);
    results = await get(user, contracts[1]);
    assert.deepEqual(results, ["300", "300"]);
  }).timeout(config.timeout);

})
