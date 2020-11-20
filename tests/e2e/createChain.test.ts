import * as path from "path";

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

let oauth:oauthUtil;
let ouser1:OAuthUser;
let ouser2:OAuthUser;

const label = 'My chain label';
const src = 'contract Governance { uint constant TEN = 10; }';
const args = {};
const members = [{
    address: "00000000000000000000000000000000deadbeef"
  , enode: "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303?discport=30303"
  }, {
    address: "0000000000000000000000000000000012345678"
  , enode: "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"
  }];
const balances = [
           { address: "00000000000000000000000000000000deadbeef"
           , balance: 1000000000000000000000
           },
           { address: "0000000000000000000000000000000012345678"
           , balance: 0
           }];

describe("Create Chain", function() {
  this.timeout(config.timeout);
  
  before(async () => {
    oauth = oauthUtil.init(config.nodes[0].oauth);
    ouser1 = await oauth.getAccessTokenByResourceOwnerCredential("user1", "1234", "strato-devel");
    ouser2 = await oauth.getAccessTokenByResourceOwnerCredential("user2", "1234", "strato-devel");
  });

  it('should create 100 new chains', async() => {
    // create user
    const alice = await rest.createUser(ouser1, options);
    const bob = await rest.createUser(ouser2, options);
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                 ,{ address: bob.address, balance: 0}
                 ];
    const mems = [{address: alice.address, enode: members[0].enode}
                 ,{address: bob.address, enode: members[1].enode}
		 ];
    for(var i = 0; i < 100; i++) {
    const chainId = await rest.createChain(ouser1, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
    console.log('###CHAINID###',chainId);
    assert.isDefined(chainId, "should exist");
    assert.notEqual(chainId, '', "should be a nonzero address");
    }

  });

  it('should create a new chain and query the chain details', async() => {
    // create user
    const alice = await rest.createUser(ouser1, options);
    const bob   = await rest.createUser(ouser2, options);
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                 ,{ address: bob.address, balance: 0}
                 ];
    const mems = [{address: alice.address, enode: members[0].enode}
                 ,{address: bob.address, enode: members[1].enode}
		 ];
    const chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
    console.log('###CHAINID###',chainId);
    assert.isDefined(chainId, "should exist");
    assert.notEqual(chainId, '', "should be a nonzero address");

    await promiseTimeout(1000);

    const chainInfo = await rest.getChain(alice, chainId, options);
    console.log('###CHAININFO###',chainInfo);
    assert.isDefined(chainInfo, "should exist");
    assert.deepEqual(label, chainInfo.info.label, "chain labels should be identical");

    const chainAddress = '0000000000000000000000000000000000000100';

    // Despite not running the constructor, bloch will at least
    // return the constants and functions.
    const state = await rest.getState(alice, {name: 'Governance', address: chainAddress, chainId}, options);
    assert.hasAnyKeys(state, ['TEN']);

    for(var i=0; i < 10; i++) {
      const txResult = await rest.send(alice, {toAddress: bob.address, value: 123456, chainId}, options);
      console.log('### TRANSACTION RESULT ###', txResult);
    }

  });

  it('should not create a new chain when members list is empty', async() => {
    // create user
    const alice = await rest.createUser(ouser1, options);
    const bob   = await rest.createUser(ouser2, options);
    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                  ,{ address: bob.address, balance: 0}
                 ];
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    let chainId;
    try {
      chainId = await rest.createChain(alice, {label, members: [], balances: bals, src, args}, {name: "Governance"}, options);
    } catch(e) {
      assert.equal(e.response.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined");
  });

  it('should not create a new chain when balances are empty', async() => {
    // create user
    const alice = await rest.createUser(ouser1, options);
    const bob   = await rest.createUser(ouser2, options);
    const mems = [{address: alice.address, enode: members[0].enode}
                  ,{address: bob.address, enode: members[1].enode}
		             ];
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    let chainId;
    try {
      chainId = await rest.createChain(alice, {label, members: mems, src, balances: [], args: {}}, {name: "Governance"}, options);
    } catch(e) {
      assert.equal(e.response.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined");
  });

  it('should create a new chain when contract source is empty', async() => {
    // create user
    const alice = await rest.createUser(ouser1, options);
    const bob   = await rest.createUser(ouser2, options);
    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                  ,{ address: bob.address, balance: 0}
                 ];
    const mems = [{address: alice.address, enode: members[0].enode}
                  ,{address: bob.address, enode: members[1].enode}
		             ];
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    const chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src: "", args}, <Contract>{}, options);
    assert.isDefined(chainId, "should exist");

    await promiseTimeout(1000);

    const chainInfo = await rest.getChain(ouser1, chainId, options);
    console.log('###CHAININFO###',chainInfo);
    assert.isDefined(chainInfo, "should exist");
  });

  it('should not create a new chain when all accounts have 0 balance', async() => {
    // create user
    const alice = await rest.createUser(ouser1, options);
    const bob   = await rest.createUser(ouser2, options);
    assert.isDefined(alice, "should exist");
    assert.isDefined(alice.address, "should be defined");
    assert.notEqual(alice.address, 0, "should be a nonzero address");
    assert.isDefined(bob, "should exist");
    assert.isDefined(bob.address, "should be defined");
    assert.notEqual(bob.address, 0, "should be a nonzero address");

    const mems = [{address: alice.address, enode: members[0].enode}
                  ,{address: bob.address, enode: members[1].enode}
		             ];
    const bals = [{ address: alice.address, balance: 0}
                 ,{ address: bob.address, balance: 0}
                 ];
    let chainId;
    try {
      chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
    } catch(e) {
      assert.equal(e.response.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(chainId, "chainId not defined");
  });

});

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(resolve, timeout);
  });
}
