"use strict";
const ba = require('blockapps-rest');
const co = require('co');
require('co-mocha');

const rest = ba.rest;
const common = ba.common;
const util = common.util;
const BigNumber = common.BigNumber;
const config = common.config;
const password = '1234';
config.apiDebug=true;

// Honestly, past this size bloc can't receive all connections.
const SIZE=10
const transactions = [...Array(SIZE).keys()].map(i => {
  const name = `ScatterUpload_${i}`
  return { nonce: i, name: name, src: `contract ${name} \{\}` }
})

async function sleep(timeout) {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

describe("Concurrent uploads", function() {

  it('should create multiple contracts and see them all in cirrus', async function () {
    this.timeout(config.timeout);
    const user_name= 'multi_contract' + util.uid();
    const user = await co.wrap(rest.createUser)(user_name, password, false);
    let balance = new BigNumber(0);
    while (balance.isZero()) {
      await sleep(500);
      balance = await co.wrap(rest.getBalance)(user.address);
    }
    console.log(`Balance of ${user_name} is ${balance}`)
    console.log("Beginning to upload contracts");
    const upload = co.wrap(rest.uploadContractString)
    const promises = transactions.map(tx =>
      upload(user, tx.name, tx.src, undefined, undefined, {nonce: tx.nonce}));
    let allResults = await Promise.all(promises);
    console.log(allResults);
    const query = co.wrap(rest.queryUntil)
    const qromises = transactions.map(tx =>
      query(tx.name, results => results.length > 0));
    let allQueries = await Promise.all(qromises);
    console.log(allQueries);
  });

});

