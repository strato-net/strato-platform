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

const label = 'My chain label';
const src = 'contract Governance { enum Rule { NOTHING, AUTO_APPROVE, TWO_VOTES_IN, MAJORITY_RULES } event MemberAdded(address member, string enode); event MemberRemoved(address member); function voteToAdd(address m, string e) { MemberAdded(m,e); } function voteToRemove(address m) { MemberRemoved(m); } }';
const args = {addRule: 'AUTO_APPROVE', removeRule: 'AUTO_APPROVE'};
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
var alicename;
var bobname;
var alice;
var bob;
var chainId;

describe("Create Chain", function() {

  before(function * () {
    this.timeout(config.timeout);
    const uid = util.uid();
    alicename = 'Alice' + uid;
    bobname = 'Bob' + uid;
    // create user
    const isAsync = true;
    alice = yield rest.createUser(alicename, password, isAsync);
    bob   = yield rest.createUser(bobname, password, isAsync);

    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                 ,{ address: bob.address, balance: 0}
                 ];
    const mems = [{address: alice.address, enode: members[0].enode}
                 ,{address: bob.address, enode: members[1].enode}
		 ];
    chainId = yield rest.createChain(label, mems, bals, src, args);
  });
  
  it('should add and remover a member from the chain', function* () {
    this.timeout(5000);

    const addName = 'voteToAdd';
    const removeName = 'voteToRemove';
    const gov = { name: 'Governance', address: '0000000000000000000000000000000000000100' }
    const args = { m: '00000000000000000000000000000000deadbeef', e: 'enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.6:30303?discport=30303' }

    yield rest.callMethod(alice, gov, addName, args, 0, chainId, false);

    const chainInfo1 = yield rest.getChainInfo(chainId);
    console.log('###CHAININFO###',chainInfo1);
    assert.deepEqual(chainInfo1.members.length, 3, "member should be added");

    yield rest.callMethod(alice, gov, removeName, args, 0, chainId, false);

    const chainInfo2 = yield rest.getChainInfo(chainId);
    console.log('###CHAININFO###',chainInfo2);
    assert.deepEqual(chainInfo2.members.length, 2, "member should be removed");

  });

});

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}
