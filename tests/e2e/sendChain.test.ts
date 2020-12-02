const ba = require('blockapps-rest');
require('co-mocha');

const rest = ba.rest;
const common = ba.common;
const api = common.api;
const util = common.util;
const BigNumber = common.BigNumber;
const config = common.config;
const process = require('process');

describe("Use chain", function() {

  it('should be able send txs on the chain', function* () {
    this.timeout(30000);
    const amount = Math.floor(Math.random() * 200000);
    const password = '1234';
    const alicename = 'Alice';
    const bobname = 'Bob';
    const alice = {
      name: alicename,
      password: password,
      address: process.env.ALICE_ADDRESS,
    };
    const bob = {
      name: bobname,
      password: password,
      address: process.env.BOB_ADDRESS,
    };
    const chainId = process.env.CHAIN_ID;
    const txResult = yield rest.send(alice, bob, amount, false, parseInt(process.env.NONCE || "0"), chainId);
    console.log('### TRANSACTION RESULT ###', txResult);
  });
});