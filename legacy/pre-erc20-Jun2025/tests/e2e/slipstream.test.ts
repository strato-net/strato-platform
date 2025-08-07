"use strict";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Config,
  Contract,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  AccessToken
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());



let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

config.apiDebug = true;

async function upload(name:string, source:string, options:Options):Promise<[BlockChainUser, Contract]> {
  const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
  const accessToken:AccessToken = await oauth.getAccessTokenByClientSecret();
  const ouser:OAuthUser = {token: accessToken.token.access_token};
  const user = await rest.createUser(ouser, options);
//  await rest.fill(user, true);
  console.log(`User ${user.address} uploading a ${name}`);
  console.log(`Source is ${source}`);
  options.doNotResolve = false;
  const contract = <Contract> await rest.createContract(user, {name, source, args: {}}, options);
  return [user, contract];
}

function toTableName(contractName){
  return `Test-${contractName}`; // prepend with Test cuz all users' commonName are Test
}

describe('Slipstream', function () {
  this.timeout(config.timeout);

  const newContract = `
contract record X {
  uint public z = 7624;
}

contract record Y {
  X x;
  constructor() public {
    x = new X();
  }
}
`;
  it("can index contracts recursively constructed", async () => {
    const [user, contract] = await upload("Y", newContract, options);
    await sleep(2000);
    const indexY = await rest.search(user, {...contract, name: toTableName("Y")}, {...options, query: {address: `eq.${contract.address}`}});
    assert.equal(indexY.length, 1, JSON.stringify(indexY, null, 2));
    const indexX = await rest.search(user, {...contract, name: toTableName("Y-X")}, options);
    console.log(`indexX returned ${JSON.stringify(indexX, null, 2)}`);
    assert.equal(indexX[0].z, "7624", "z");
  });


  const Counter = `
contract record Z {
  uint public count = 0;
  function incr() public {
    count++;
  }
}
`;
  it("Will index updates to a contract", async () => {
    const [user, contract] = await upload("Z", Counter, options);
    await sleep(2000);
    let indexZ = await rest.search(user, {...contract, name: toTableName("Z")}, {...options, query: {address: `eq.${contract.address}`}});
    assert.equal(indexZ.length, 1, JSON.stringify(indexZ, null, 2));
    console.log(`Initial index: ${JSON.stringify(indexZ, null, 2)}`);
    let res = await rest.call(user, {contract, method: "incr", args: {}}, options);
    console.log(`Incr result 1: ${JSON.stringify(res, null, 2)}`);
    await sleep(2000);
    indexZ = await rest.search(user, {...contract, name: toTableName("Z")}, {...options, query: {count: "eq.1"}});
    console.log(`Second index: ${JSON.stringify(indexZ, null, 2)}`);
    res = await rest.call(user, {contract, method: "incr", args: {}}, options);
    console.log(`Incr result 2: ${JSON.stringify(res, null, 2)}`);
    await sleep(2000);
    indexZ = await rest.search(user, {...contract, name: toTableName("Z")}, {...options, query: {count: "eq.2"}});
    console.log(`Last index: ${JSON.stringify(indexZ, null, 2)}`);
  });


const eventsContract = `
contract record EventTest {
  event SlipstreamTest ( uint magic );
  function emitTest ( uint magic ) {
    emit SlipstreamTest ( magic );
  }
}`;

  it("Will create and insert into tables for valid solidity events", async () => {
    // MUST USE SOLIDVM - EVM does not know about events
    let vmOptions = {config};
    vmOptions.config.VM = 'SolidVM';


    // multiple inserts with a single contract instance
    const [user,contract] = await upload("EventTest", eventsContract, vmOptions);
    let magic = 97;
    let res = await rest.call(user, {contract, method: "emitTest", args: {magic}}, vmOptions);
    await sleep(2000);
    res = await rest.search(user, {...contract, name: toTableName("EventTest-SlipstreamTest")}, {...vmOptions, query: {magic: "eq.97"}});
    assert.equal(res[0].magic, magic);
    magic = 98;
    res = await rest.call(user, {contract, method: "emitTest", args: {magic}}, vmOptions);
    await sleep(2000);
    res = await rest.search(user, {...contract, name: toTableName("EventTest-SlipstreamTest")}, {...vmOptions, query: {magic: "eq.98"}});
    assert.equal(res[0].magic, magic)
    magic = 99;
    res = await rest.call(user, {contract, method: "emitTest", args: {magic}}, vmOptions);
    await sleep(2000);
    res = await rest.search(user, {...contract, name: toTableName("EventTest-SlipstreamTest")}, {...vmOptions, query: {magic: "eq.99"}});

    assert.equal(res[0].magic, magic)


    // insert with a different instance of the same contract (same table)
    const [user2,contract2] = await upload("EventTest", eventsContract, vmOptions);
    magic = 97;
    res = await rest.call(user2, {contract: contract2, method: "emitTest", args: {magic}}, vmOptions);
    await sleep(2000);
    res = await rest.search(user, {...contract, name: toTableName("EventTest-SlipstreamTest")}, {...vmOptions, query: {magic: "eq.97"}});
    assert.equal(res[0].magic, magic)
    magic = 900;
    res = await rest.call(user2, {contract: contract2, method: "emitTest", args: {magic}}, vmOptions);
    await sleep(2000);
    res = await rest.search(user, {...contract, name: toTableName("EventTest-SlipstreamTest")}, {...vmOptions, query: {magic: "eq.900"}});
    assert.equal(res[0].magic, magic)
  });

const keywordEventsContract = `
contract record KeywordEventTest {
  event Keywords (uint from, uint to);
  function emitKeyword (uint from, uint to) {
    emit Keywords(from, to);
  }
}`;

  it("Will create and insert into event tables using escaped SQL keywords", async () => {
    // MUST USE SOLIDVM - EVM does not know about events
    let vmOptions = {config};
    vmOptions.config.VM = 'SolidVM';

    // multiple inserts with a single contract instance
    const [user,contract] = await upload("KeywordEventTest", keywordEventsContract, vmOptions);
    let from = 1, to = 2;
    let res = await rest.call(user, {contract, method: "emitKeyword", args: {from, to}}, vmOptions);
    await sleep(2000);
    res = await rest.search(user, {...contract, name: toTableName("KeywordEventTest-Keywords")}, {...vmOptions, query: {from: "eq.1"}});
    assert.equal(res[0].from, from);
    assert.equal(res[0].to, to);
  });



  it("Will expand Cirrus tables when contract versions with new fields are created", async () => {
    const version1 = "contract record ExpansionTest { uint x; constructor() { x = 0; } }";
    const version2 = "contract record ExpansionTest { uint x; uint y; constructor() { x = 2; y = 10; } }";

    const [user, contract] = await upload("ExpansionTest", version1, options);
    const v1SearchList = await rest.searchUntil(user, {...contract, name: toTableName("ExpansionTest")}, (r) => r.length > 0, {...options, query: {address: `eq.${contract.address}`}});
    assert.equal(v1SearchList.length, 1, "one result from Cirrus");
    const v1 = v1SearchList[0];
    assert.equal(v1.x, 0, "first version appears correctly in Cirrus");

    const [user2, contract2] = await upload("ExpansionTest", version2, options);
    const v2SearchList = await rest.searchUntil(user, {...contract, name: toTableName("ExpansionTest")}, (r) => r.length > 0, {...options, query: {address: `eq.${contract2.address}`}});
    assert.equal(v2SearchList.length, 1, "one result from Cirrus");
    const v2 = v2SearchList[0];
    assert.equal(v2.x, 2, "second version appears correctly in Cirrus");
    assert.equal(v2.y, 10, "second version new field appears correctly in Cirrus");
  });

});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
