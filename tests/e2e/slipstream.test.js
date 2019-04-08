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

async function upload(name, source) {
  const username = `SlipstreamTester_${util.uid()}`;
  const password = "2345";
  const user = await co.wrap(rest.createUser)(username, password);
  await co.wrap(rest.fill)(user, true);
  console.log(`User ${user.name}@${user.address} uploading a ${name}`);
  console.log(`Source is ${source}`);
  const contract = await co.wrap(rest.uploadContractString)(user, name, source);
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

});
