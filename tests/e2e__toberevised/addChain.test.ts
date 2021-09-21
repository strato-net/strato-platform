const ba = require('blockapps-rest');
require('co-mocha');

const rest = ba.rest;
const common = ba.common;
const api = common.api;
const util = common.util;
const BigNumber = common.BigNumber;
const config = common.config;
const process = require('process');

const multinode101 = "enode://afc330c8d72b8468b5b401cb6ce76931bb2e757b61cdb09f8be5b6fdb50075dad55f616d63902051007586d488710499c2a15d02b5d1ce9cd352427b6b66de64@3.81.197.53:30303?discport=30303"

describe("Use chain", function() {

  it('should be able to augment the chain', function* () {
    this.timeout(30000);
    const password = '1234';
    const alicename = 'Alice';
    const alice = {
      name: alicename,
      password: password,
      address: process.env.ALICE_ADDRESS,
    };
    const chainId = process.env.CHAIN_ID;
    const contract = {
        name: 'Governance',
        address: '0000000000000000000000000000000000000100',
    };
    const args = {
      _member: '7777777777777777777777777777777777777777',
      _enode: multinode101
    };
    const txResult = yield rest.callMethod(alice, contract, 'add', args, 0, false, chainId);
    console.log('### TRANSACTION RESULT ###', txResult);

    const newChainInfo = yield rest.getChainInfo(chainId);
    console.log('### NEW CHAININFO ###', newChainInfo);

  });
});
