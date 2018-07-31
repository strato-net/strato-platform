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

const chainLabel = 'My chain label';
const accountInfo = [
        [ "0x5815b9975001135697b5739956b9a6c87f1c575c", 2000 ] ,
        [ "0x93fdd1d21502c4f87295771253f5b71d897d911c", 4000000 ] ,
        [ "0000000000000000000000000000000000deadbeef", 12345, "6b0d5d3309777e2e799976ea377ce6aeb4a485b1e7cae56f41a85ada9855fb99" ] ]
const codeInfo = [
       [ "/BEF", "me", "you" ] ,
       [ "aNoThErByTeStRiNg", "you", "me" ] ]
const members = [
       { address  : "00000000000000000000000000000000deadbeef" ,
         enodeURL :"enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303?discport=30303"
       } ,
       { address  :  "0000000000000000000000000000000012345678" ,
         enodeURL : "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"
       }];

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

    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                 ,{ address: bob.address, balance: 0}
                 ];
    const chainId = yield rest.createChain(chainLabel, accountInfo, codeInfo, members);

    console.log('###CHAINID###',chainId);
    assert.isDefined(chainId, "should exist");
    assert.notEqual(chainId, '', "should be a nonzero address");

    yield promiseTimeout(1000);

    const chainInfo = yield rest.getChainInfo(chainId);
    console.log('###CHAININFO###',chainInfo);
    assert.isDefined(chainInfo, "should exist");
    assert.equal(chainLabel, chainInfo.chainLabel, "chain labels should be identical");
    assert.deepEqual(accountInfo, chainInfo.accountInfo, "chain account infos should be identical");
    assert.deepEqual(codeInfo, chainInfo.codeInfo, "chain code infos should be identical");
    assert.deepEqual(members, chainInfo.members, "chain members should be identical");
    for(var i=0; i < 10; i++) {
      const txResult = yield rest.send(alice, bob, 123456, chainId);
      console.log('### TRANSACTION RESULT ###', txResult);
    }

  });

  it('should not create a new chain when addRule is empty', function* () {
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

    let chainId;
    try {
      chainId = yield rest.createChain(chainLabel, [], codeInfo, members);
    } catch(e) {
      assert.equal(e.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined");
  });

  it('should not create a new chain when removeRule is empty', function* () {
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

    let chainId;
    try {
      chainId = yield rest.createChain(chainLabel, accountInfo, [], members);
    } catch(e) {
      assert.equal(e.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined");
  });

  it('should not create a new chain when member list is empty', function* () {
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

    let chainId;
    try {
      chainId = yield rest.createChain(chainLabel, accountInfo, codeInfo, []);
    } catch(e) {
      assert.equal(e.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined");
  });

  it('should not create a new chain when all accounts have 0 balance', function* () {
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
/*
    const bals = [{ address: alice.address, balance: 0}
                 ,{ address: bob.address, balance: 0}
                 ];
    let chainId;
    try {
      chainId = yield rest.createChain(label, addRule, removeRule, members, bals);
    } catch(e) {
      assert.equal(e.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined"); */
  });
});

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}
