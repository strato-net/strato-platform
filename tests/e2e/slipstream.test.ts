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
  constants
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());



let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

config.apiDebug = true;

async function upload(name:string, source:string, options:Options):Promise<[BlockChainUser, Contract]> {
  const oauth:oauthUtil = oauthUtil.init(config.nodes[0].oauth);
  const ouser = await oauth.getAccessTokenByClientSecret();
  const user = await rest.createUser(ouser, options);
//  await rest.fill(user, true);
  console.log(`User ${user.address} uploading a ${name}`);
  console.log(`Source is ${source}`);
  options.doNotResolve = false;
  const contract = <Contract> await rest.createContract(user, {name, source, args: {}}, options);
  return [user, contract];
}



describe('Slipstream', async () => {
  const stringArray = `
contract StringArray {
  string[] xs = ["first", "second", "third"];
}
`;

  it("can index string arrays", async () => {
    const [user, contract] = await upload("StringArray", stringArray, options);
    const index = await rest.search(user, contract,
    	  {...options, query: {address: `eq.${contract.address}`}});
    console.log(`Index returned ${JSON.stringify(index, null, 2)}`);
    assert.equal(index[0].address, contract.address, "address");
    assert.deepEqual(index[0].xs, ["first", "second", "third"], "xs");

  }).timeout(config.timeout);

  const newContract = `
contract X {
  uint public z = 7624;
}

contract Y {
  X x;
  constructor() public {
    x = new X();
  }
}
`;
  it("can index contracts recursively constructed", async () => {
    const [user, contract] = await upload("Y", newContract, options);
    const indexY = await rest.search(user, {...contract, name: "Y"}, options);
    assert.equal(indexY.length, 1, JSON.stringify(indexY, null, 2));
    const indexX = await rest.search(user, {...contract, name: "X"}, options);
    console.log(`indexX returned ${JSON.stringify(indexX, null, 2)}`);
    assert.equal(indexX[0].z, "7624", "z");
  }).timeout(config.timeout);


  const Counter = `
contract Z {
  uint public count = 0;
  function incr() public {
    count++;
  }
}
`;
  it("Will index updates to a contract", async () => {
    const [user, contract] = await upload("Z", Counter, options);
    let indexZ = await rest.search(user, {...contract, name: "Z"}, options);
    assert.equal(indexZ.length, 1, JSON.stringify(indexZ, null, 2));
    console.log(`Initial index: ${JSON.stringify(indexZ, null, 2)}`);
    let res = await rest.call(user, {contract, method: "incr", args: {}}, options);
    console.log(`Incr result 1: ${JSON.stringify(res, null, 2)}`);
    indexZ = await rest.search(user, {...contract, name: "Z"}, {...options, query: {count: "eq.1"}});
    console.log(`Second index: ${JSON.stringify(indexZ, null, 2)}`);
    res = await rest.call(user, {contract, method: "incr", args: {}}, options);
    console.log(`Incr result 2: ${JSON.stringify(res, null, 2)}`);
    indexZ = await rest.search(user, {...contract, name: "Z"}, {...options, query: {count: "eq.2"}});
    console.log(`Last index: ${JSON.stringify(indexZ, null, 2)}`);
  }).timeout(config.timeout);


const eventsContract = `
contract EventTest {
  event SlipstreamTest ( uint magic );
  function emitTest ( uint magic ) {
    emit SlipstreamTest ( magic );
  }
}`;

  it("Will create and insert into tables for valid solidity events", async () => {
    // MUST USE SOLIDVM - EVM does not know about events
    let options = {'VM' : 'SolidVM', 'doNotResolve' : false, config};

    // multiple inserts with a single contract instance
    const [user,contract] = await upload("EventTest", eventsContract, options);
    let magic = 97;
    let res = await rest.call(user, {contract, method: "emitTest", args: {magic}}, options);
    res = await rest.search(user, {...contract, name: "SlipstreamTest"}, {...options, query: {magic: "eq.97"}});
    magic = 98;
    res = await rest.call(user, {contract, method: "emitTest", args: {magic}}, options);
    res = await rest.search(user, {...contract, name: "SlipstreamTest"}, {...options, query: {magic: "eq.98"}});
    magic = 99;
    res = await rest.call(user, {contract, method: "emitTest", args: {magic}}, options);
    res = await rest.search(user, {...contract, name: "SlipstreamTest"}, {...options, query: {magic: "eq.99"}});
   
    // insert with a different instance of the same contract (same table)
    const [user2,contract2] = await upload("EventTest", eventsContract, options);
    magic = 97;
    res = await rest.call(user2, {contract: contract2, method: "emitTest", args: {magic}}, options);
    res = await rest.search(user, {...contract, name: "SlipstreamTest"}, {...options, query: {magic: "eq.97"}});
    magic = 900;
    res = await rest.call(user2, {contract: contract2, method: "emitTest", args: {magic}}, options);
    res = await rest.search(user, {...contract, name: "SlipstreamTest"}, {...options, query: {magic: "eq.900"}});
  }).timeout(config.timeout);



});
