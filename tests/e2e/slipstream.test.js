"use strict";

const chai = require('chai');
const assert = chai.assert;
const co = require('co');
require('co-mocha');

const ba = require('blockapps-rest');
const config = ba.common.config;
const rest = ba.rest6;
const util = ba.common.util;

config.apiDebug = true;

async function upload(name, source, options={}) {
  const username = `SlipstreamTester_${util.uid()}`;
  const password = "2345";
  const user = await co.wrap(rest.createUser)(username, password);
  await co.wrap(rest.fill)(user, true);
  console.log(`User ${user.name}@${user.address} uploading a ${name}`);
  console.log(`Source is ${source}`);
  options.doNotResolve = false;
  const contract = await co.wrap(rest.uploadContractString)(user, name, source, {}, options=options);
  return [user, contract];
}



describe('Slipstream', async () => {
  const stringArray = `
contract StringArray {
  string[] xs = ["first", "second", "third"];
}
`;

  it("can index string arrays", async () => {
    const [user, contract] = await upload("StringArray", stringArray);
    const index = await co.wrap(rest.waitQuery)(
      `${contract.name}?address=eq.${contract.address}`, 1);
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
    const [user, contract] = await upload("Y", newContract);
    const indexY = await co.wrap(rest.waitQuery)("Y", 1);
    assert.equal(indexY.length, 1, JSON.stringify(indexY, null, 2));
    const indexX = await co.wrap(rest.waitQuery)("X", 1);
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
    const [user, contract] = await upload("Z", Counter);
    let indexZ = await co.wrap(rest.waitQuery)("Z", 1);
    assert.equal(indexZ.length, 1, JSON.stringify(indexZ, null, 2));
    console.log(`Initial index: ${JSON.stringify(indexZ, null, 2)}`);
    let res = await co.wrap(rest.callMethod)(user, contract, "incr");
    console.log(`Incr result 1: ${JSON.stringify(res, null, 2)}`);
    indexZ = await co.wrap(rest.waitQuery)("Z?count=eq.1", 1);
    console.log(`Second index: ${JSON.stringify(indexZ, null, 2)}`);
    res = await co.wrap(rest.callMethod)(user, contract, "incr");
    console.log(`Incr result 2: ${JSON.stringify(res, null, 2)}`);
    indexZ = await co.wrap(rest.waitQuery)("Z?count=eq.2", 1);
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
    // USING SolidVM (no EVM event support yet)
    let options = {'VM' : 'SolidVM', 'doNotResolve' : false};

    // multiple inserts with a single contract instance
    const [user,contract] = await upload("EventTest", eventsContract, options);
    let magic = 97;
    let res = await co.wrap(rest.callMethod)(user, contract, "emitTest", {magic}, options);
    res = await co.wrap(rest.waitQuery)("EventTest.SlipstreamTest?magic=eq.97", 1);
    magic = 98;
    res = await co.wrap(rest.callMethod)(user, contract, "emitTest", {magic}, options);
    res = await co.wrap(rest.waitQuery)("EventTest.SlipstreamTest?magic=eq.98", 1);
    magic = 99;
    res = await co.wrap(rest.callMethod)(user, contract, "emitTest", {magic}, options);
    res = await co.wrap(rest.waitQuery)("EventTest.SlipstreamTest?magic=eq.99", 1);
   
    // insert with a different instance of the same contract (same table)
    const [user2,contract2] = await upload("EventTest", eventsContract, options);
    magic = 97;
    res = await co.wrap(rest.callMethod)(user2, contract2, "emitTest", {magic}, options);
    res = await co.wrap(rest.waitQuery)("EventTest.SlipstreamTest?magic=eq.97", 2);
    magic = 900;
    res = await co.wrap(rest.callMethod)(user2, contract2, "emitTest", {magic}, options);
    res = await co.wrap(rest.waitQuery)("EventTest.SlipstreamTest?magic=eq.900", 1);
  }).timeout(config.timeout);



});
