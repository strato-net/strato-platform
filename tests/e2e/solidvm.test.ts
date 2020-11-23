"use strict";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Contract,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  AccessToken
  } from 'blockapps-rest';

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config};

let user:BlockChainUser;

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

const deployAndModify = `
${partialModify}

contract Deployer {
  PartialModify pm;

  constructor() public {
    pm = new PartialModify();
    pm.doubleY();
  }
}
`;

const enumContract = `contract EnumContract {
  enum E {A, B, C, D}
  E e = E.C;
}
`;

const stringsContract = `contract StringReturns {

  function single() returns (string) {
    return "how are you?";
  }

  function stringTup() returns (string, string) {
    return ("I'm fine thanks,", "how have you been?");
  }

  function mixedTup() returns (uint, string, address, string) {
    return (42, "the meaning of life", msg.sender, "STRATO");
  }
}
`;

async function upload(vm, name, source):Promise<Contract> {
  console.log(`User ${user.address} uploading a ${name} to the ${vm}`);
  return <Contract> await rest.createContract(user, {name, source, args: {}}, {config:{...config, VM: vm}});
}

async function incr(user, contract, vm) {
  return await rest.call(user, {contract, method: "incr", args: {}}, {config:{...config, VM: vm}});
}

async function read(user, contract, vm) {
  return await rest.call(user, {contract, method: "read", args: {}}, {config:{...config, VM: vm}});
}

async function doubleY(user, contract, vm) {
  return await rest.call(user, {contract, method: "doubleY", args: {}}, {config:{...config, VM: vm}});
}

async function state(contract:Contract) {
  return await rest.getState(user, contract, options);
}

async function index(contract:Contract) {
  return await rest.search(user, contract, {...options, query: {address: `eq.${contract.address}`}});
}

describe('Solid VM: Contract uploads', async () => {

  before(async () => {
    const oauth:oauthUtil = oauthUtil.init(config.nodes[0].oauth);
    const accessToken:AccessToken = await oauth.getAccessTokenByClientSecret();
    const ouser:OAuthUser = {token: accessToken.token.access_token};
    user = await rest.createUser(ouser, options);
  });

  it ('can count upwards on the SolidVM counter', async () => {
    const contract:Contract = await upload('SolidVM', 'Counter', counter);
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
    const contract = await upload('SolidVM', 'PartialModify', partialModify);
    console.log(`Contract is ${JSON.stringify(contract)}`);
  
    const index1 = await rest.search(user, contract,
      {...options, query: {address: `eq.${contract.address}`}});
    console.log(`First index response is: ${JSON.stringify(index1)}`);
    assert.equal(index1[0].address, contract.address);
    assert.equal(index1[0].x, 83);
    assert.equal(index1[0].y, 72);

    await doubleY(user, contract, 'SolidVM');

    const index2 = await rest.search(user, contract,
      {...options, query: {address: `eq.${contract.address}`, y: "eq.144"}});
    assert.equal(index2[0].address, contract.address);
    assert.equal(index2[0].x, 83);
    assert.equal(index2[0].y, 144);
  }).timeout(config.timeout);

  it ('merges concurrent deltas', async () => {
    const contract = await upload('SolidVM', 'Deployer', deployAndModify);

    const deployIndex = await rest.search(user, contract,
      {...options, query: {address: `eq.${contract.address}`}});
     console.log(`Index response is: ${JSON.stringify(deployIndex)}`);
    const pm = deployIndex[0].pm;
    const modifyIndex = await rest.search(user, {...contract, name: "PartialModify"},
      {...options, query: {address: `eq.${pm}`}});
    assert.equal(modifyIndex[0].address, pm);
    assert.equal(modifyIndex[0].y, 144, "has y");
    assert.equal(modifyIndex[0].x, 83, "has x");
  }).timeout(config.timeout);

  it ('Indexes enums numerically', async () => {
    const contract = await upload('SolidVM', 'EnumContract', enumContract);

    const index = await rest.search(user, contract,
      {...options, query: {address: `eq.${contract.address}`}});
    console.log(`Index returned: ${JSON.stringify(index, null, 2)}`);
    assert.equal(index[0].address, contract.address);
    assert.equal(index[0].e, 2);
  }).timeout(config.timeout);

  it ('Can encode strings as return values', async () => {
    const contract = await upload('SolidVM', 'StringReturns', stringsContract);

    const single =  await rest.call(user,
        {contract, method: "single", args: {}}, {config: {...config, 'VM': 'SolidVM'}});
    const stringTup = await rest.call(user,
        {contract, method: "stringTup", args: {}}, {config: {...config, 'VM': 'SolidVM'}});
    const mixedTup = await rest.call(user,
        {contract, method: "mixedTup", args: {}}, {config: {...config, 'VM': 'SolidVM'}});

    console.log(`Single: ${JSON.stringify(single)}`);
    assert.equal(single, "how are you?");
    console.log(`StringTup: ${JSON.stringify(stringTup)}`); 
    assert.equal(stringTup[0], "I'm fine thanks,");
    assert.equal(stringTup[1], "how have you been?");
    console.log(`MixedTup: ${JSON.stringify(mixedTup)}`); 
    assert.equal(mixedTup[0], 42);
    assert.equal(mixedTup[1], "the meaning of life");
    assert.equal(mixedTup[3], "STRATO");
   

  }).timeout(config.timeout);
})
