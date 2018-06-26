const ba = require('blockapps-rest');
require('co-mocha');

const rest = ba.rest;
const common = ba.common;
const api = common.api;
const util = common.util;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;
const config = common.config;

const password = '1234';

describe("Create Chain", function() {

  it('should create a new chain and query the chain details', function* () {
    this.timeout(config.timeout);
    const uid = util.uid();
    const alicename = 'Alice' + uid;
    const bobname = 'Bob' + uid;
    // create user
    const isAsync = true;
    const alice = yield rest.createUser(alicename, password, isAsync);
    const bob   = yield rest.createUser(bobname, password, isAsync);
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    const label = 'My chain label';
    const addRule = 'My add rule';
    const removeRule = 'My remove rule';
    const members = ['member1','member2'];
    const balances = [
               { address:"00000000000000000000000000000000deadbeef"
               , balance:"0000000000000000000000000000000000000001000000000000000000000000"
               },
               { address:"0000000000000000000000000000000012345678"
               , balance:"0000000000000000000000000000000000000001234500000000000000000000"
               }];
    console.log(balances);
    const chainId = yield rest.createChain(label, addRule, removeRule, members, balances);
    assert.isDefined(chainId, "should exist");
    assert.notEqual(chainId, '', "should be a nonzero address");

    const chainInfo = yield rest.getChainInfo(chainId);
    assert.isDefined(chainInfo, "should exist");
    assert.isEqual(label, chainInfo.label, "chain labels should be identical");
    assert.isEqual(addRule, chainInfo.addRule, "chain labels should be identical");
    assert.isEqual(removeRule, chainInfo.removeRule, "chain labels should be identical");
    assert.isEqual(members, chainInfo.members, "chain labels should be identical");
    assert.isEqual(balances, chainInfo.balances, "chain labels should be identical");
  });

});
