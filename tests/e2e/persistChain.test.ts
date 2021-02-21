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
const src = `contract Governance {
  uint constant TEN = 10;
  event MemberAdded(address addr, string enode);
  function add(address _member, string _enode) public {
    emit MemberAdded(_member, _enode);
  }
}
`;
const args = {};

const multinode101 = "enode://afc330c8d72b8468b5b401cb6ce76931bb2e757b61cdb09f8be5b6fdb50075dad55f616d63902051007586d488710499c2a15d02b5d1ce9cd352427b6b66de64@3.81.197.53:30303?discport=30303"
const multinode102 = "enode://5b297dc9f1616e7d7f013a5702756f2abf2f8dd3cdfd5dd0fd5687eb4ceb3655165efb3492d4f581d7dbfe6edd91a62c7b7aa7701efcfbc3c2971d2b0d449003@18.235.213.241:30303?discport=30303"
const multinode103 = "enode://884c874799e971cb22001a9552351ae05e996af0fe33859706c5ad890478cde46b5dd1a692f6eceedfaf7e3229d168dd7aeba9b9cae18039d5b433dc08a81db9@3.209.126.162:30303?discport=30303"
const multinode104 = "enode://026f8078733f67d1ba3ab9653d20ffd070514f6afc94d8de002b39dfb2bc01ab897f11c18b683493ec4a9958898b41bd126686b90ae8c0cef8ba95739ed2b365@34.237.166.201:30303?discport=30303"
const enodes = [multinode102, multinode103, multinode104, multinode101];


describe("Create Chain", function() {

  it('should create a new chain and query the chain details', function* () {
    this.timeout(60000);
    const alicename = 'Alice';
    const bobname = 'Bob';
    const chuckname = 'Chuck';
    const danyname = 'Dany';
    // create user
    const isAsync = true;
    const alice = yield rest.createUser(alicename, password, isAsync);
    const bob   = yield rest.createUser(bobname, password, isAsync);
    const chuck = yield rest.createUser(chuckname, password, isAsync);
    const dany = yield rest.createUser(danyname, password, isAsync);

    console.log(`Alice is ${JSON.stringify(alice)}`);
    for (const user of [alice, bob, chuck]) {
      assert.isDefined(user, "should exist");
      assert.isDefined(user.address, "should have an address");
      assert.notEqual(user.address, 0, "should have a nonzero address");
    }
    const count = 3;
    const bals = [{ address: alice.address, balance: 1000000000000000000000}
                 ,{ address: bob.address, balance: 239487}
                 ,{ address: chuck.address, balance: 3000}
                 ,{ address: dany.address, balance: 20000}
                 ].slice(0, count);
    const mems = [{address: alice.address, enode: enodes[0]}
                 ,{address: bob.address, enode: enodes[1]}
                 ,{address: chuck.address, enode: enodes[2]}
                 ,{address: dany.address, enode: enodes[3]}
                 ].slice(0, count);
    const chainId = yield rest.createChain(label, mems, bals, src, args);
    console.log('###CHAINID###',chainId);
    assert.isDefined(chainId, "should exist");
    assert.notEqual(chainId, '', "should be a nonzero address");

    yield promiseTimeout(1000);

    const chainInfo = yield rest.getChainInfo(chainId);
    console.log('###CHAININFO###',chainInfo);
    assert.isDefined(chainInfo, "should exist");
    assert.deepEqual(label, chainInfo.label, "chain labels should be identical");

    const chainAddress = '0000000000000000000000000000000000000100';

    // Despite not running the constructor, bloch will at least
    // return the constants and functions.
    const state = yield api.bloc.state('Governance', chainAddress, chainId);
    assert.hasAnyKeys(state, ['TEN']);

    const txResult = yield rest.send(alice, bob, 123456, false, null, chainId);
    console.log('### TRANSACTION RESULT ###', txResult);

  });
});

function promiseTimeout(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}
