const ba = require('blockapps-rest');
require('co-mocha');
const co = require('co');

const rest = ba.rest;
const common = ba.common;
const util = common.util;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;
const config = common.config;

describe("Send Transaction Test", function() {
  this.timeout(config.timeout);

  const uid = util.uid();
  const userPairs = [];
  const nodes = config.nodes;
  const password = '1234';
  const value = new BigNumber(8).mul(constants.ETHER); // 8 eth in wei

  beforeEach(function* () {
    // create a pair of users on every node
    yield createUserPairs(uid, password, userPairs);
    yield sleep(30);
  });

  it('should send correct amount ONCE between all pairs', function* () {
    // for each node
    for (let node of nodes) {
      // send alice->bob on that node
      const pair = userPairs[node.id];
      yield send(node.id, pair.alice, pair.bob, value);
      // check balance for those accounts on each node
      yield checkBalance(pair.alice, pair.bob, value);
    }
  });

  it('should send to one node, and check results on all nodes', function* () {
    const nodeId = 0;
    const pair = userPairs[nodeId];
    const nonce = undefined;
    const receipt = yield rest.send(pair.alice, pair.bob, value, nonce, nodeId);

    // for each node
    for (let node of nodes) {
      const txResult = yield rest.transactionResult(receipt.hash, node.id);
      assert.equal(txResult[0].status, 'success', 'tx status node ' + node.id);
    }
  });

  it('should send to one node, and check results on all nodes in PARALLEL', function* () {
    const nodeId = 0;
    const pair = userPairs[nodeId];
    const nonce = undefined;

    const count = 3;
    for (var i = 0; i < count; i++) {
      const receipt = yield rest.send(pair.alice, pair.bob, value, nonce, nodeId);
      const promises = createPromises(receipt);
      yield Promise.all(promises).then(function(resultsArray) {
        resultsArray.map(txResult => {
          assert.equal(txResult[0].status, 'success', 'tx status');
        })
      });
    }

    function createPromises(receipt) {
      const promises = [];
      for (let node of nodes) {
        const promise = co(rest.transactionResult(receipt.hash, node.id));
        promises.push(promise);
      }
      return promises;
    }
  });

  it('should send correct amount multiple time to ONE pair.', function* () {
    const count = 2;
    const node = nodes[0];
    var nonce = 0;
    // send alice->bob on that node
    const pair = userPairs[node.id];
    for (var i = 0; i < count; i++) {
      yield send(node.id, pair.alice, pair.bob, value, nonce++);
      yield checkBalance(pair.alice, pair.bob, value.times(i+1));
    }
  });

  it('should send correct amount multiple time to ONE pair.  https://blockapps.atlassian.net/browse/API-20', function* () {
    const count = 2;
    const node = nodes[0];
    var nonce = 0;
    // send alice->bob on that node
    const pair = userPairs[node.id];
    for (var i = 0; i < count; i++) {
      yield send(node.id, pair.alice, pair.bob, value, nonce++);
      yield checkBalance(pair.alice, pair.bob, value.times(i+1));
    }
  });

  it('should send correct amount MULTIPLE TIMES between all pairs.  https://blockapps.atlassian.net/browse/API-20', function* () {
    const count = 2;
    var nonce = 0;
    // send multiple
    console.log('Here are the nodes', nodes);
    for (var i=0; i < count; i++) {
      for (let node of nodes) {
        // send alice->bob on that node
        const pair = userPairs[node.id];
        yield send(node.id, pair.alice, pair.bob, value, nonce++);
      }
    }
    // check balance for those accounts on each node
    const pair = userPairs[0];
    const total = value.times(count);
    yield checkBalance(pair.alice, pair.bob, total);
  });

  it('send parallel - https://blockapps.atlassian.net/browse/API-20', function* () {
    const promises = [];
    const count = 1;
    var nonce = 0;
    for (var i = 0; i < count; i++) {
      for (let node of nodes) {
        // send alice->bob on that node
        const pair = userPairs[node.id];
        const promise = co(send(node.id, pair.alice, pair.bob, value, nonce++));
        promises.push(promise);
      }
    }

    yield Promise.all(promises).then(function(resultsArray) {
      //console.log('txResult', txResult);
    });
    // check balance for those accounts on each node
    const pair = userPairs[0];
    const total = value.times(count);
    yield checkBalance(pair.alice, pair.bob, total);
  });

  it('should send correct amount of ether', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;

    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.startingBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.startingBalance = new BigNumber(bob.accounts[0].balance);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send
    const receipt = yield rest.send(alice, bob, value);
    const txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');
    // check balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.endBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.endBalance = new BigNumber(bob.accounts[0].balance);

    //TODO Calculate gas cost and factor into balance
    assert.isOk(alice.startingBalance.minus(value).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(value).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
  });

  // ================================================================
  function* createUserPairs(uid, password, pairs) {
    console.log('creating users');
    for (let node of nodes) {
      // create
      const aliceName = `Alice_${node.id}_${uid}`;
      const alice = yield rest.createUser(aliceName, password, node.id);
      console.log('alice', alice);
      const bobName = `Bob_${node.id}_${uid}`;
      const bob = yield rest.createUser(bobName, password, node.id);
      console.log('bob', bob);
      const pair = {alice: alice, bob:bob};
      pairs[node.id]= pair;
      // test creation on the node
      const users = yield rest.getUsers(node.id);
      const found = users.filter(user => {
        return user === aliceName || user === bobName;
      });
      assert.equal(found.length, 2, 'must find both');
    }
    console.log('DONE creating users');
  }

  function sleep(milli) {
    console.log('sleep', milli);
    return new Promise(resolve => setTimeout(resolve, milli));
  }

  function* send(nodeId, alice, bob, value, nonce) {
    // it is OK for nonce to be undefined!
    console.log('send', nodeId, alice.name, bob.name, value.toString(), nonce);
    const receipt = yield rest.send(alice, bob, value, false, nonce, nodeId);
    const txResult = yield rest.transactionResult(receipt.hash, nodeId);
    assert.equal(txResult[0].status, 'success', 'tx status');
    return txResult[0];
  }

  function* checkBalance(alice, bob, value) {
    const ACCOUNT_INDEX = 0;
    const FAUCET_AWARD = new BigNumber(1000).times(constants.ETHER) ;

    for (let node of nodes) {
      const pair = userPairs[node.id];
      console.log('checkBalance', node.id, pair.alice.name, pair.bob.name, value.toString());
      // check balances
      const aliceBalance = yield rest.getBalance(alice.address, ACCOUNT_INDEX, node.id);
      const bobBalance = yield rest.getBalance(bob.address, ACCOUNT_INDEX, node.id);
      bobBalance.should.be.bignumber.eq(FAUCET_AWARD.plus(value));
    }
  }

});
