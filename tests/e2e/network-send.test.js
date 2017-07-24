const ba = require('blockapps-rest');
require('co-mocha');

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
  const etherToSend = 8;

  before(function* () {
    for (let node of nodes) {
      const aliceName = `Alice_${node.id}_${uid}`;
      const alice = yield rest.createUser(aliceName, password, node.id);
      const bobName = `Bob_${node.id}_${uid}`;
      const bob = yield rest.createUser(bobName, password, node.id);
      const pair = {alice: alice, bob:bob};
      userPairs[node.id]= pair;
      const users = rest.getUsers(node.id);
    }
  });

  it.only('should send correct amount of ether between all couples', function* () {
    throw new Error(999);
    // for each node
    for (let node of nodes) {
      // send alice->bob on that node
      const pair = userPairs[node.id];
      yield send(node.id, pair.alice, pair.bob, etherToSend);
      // TODO delay
      console.log('delay');
      // check balance for those accounts on each node
      yield checkBalance(pair.alice, pair.bob, etherToSend);
    }
  });

  function* send(nodeId, alice, bob, etherToSend) {
    console.log('send', nodeId, alice.name, bob.name, etherToSend);
    const receipt = yield rest.send(alice, bob, etherToSend);
    const txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');
  }

  function* checkBalance(alice, bob, etherToSend) {
    const ACCOUNT_INDEX = 0;
    const FAUCET_AWARD = new BigNumber(1000).times(constants.ETHER) ;
    const delta = new BigNumber(etherToSend).mul(constants.ETHER);

    for (let node of nodes) {
      const pair = userPairs[node.id];
      console.log('checkBalance', node.id, pair.alice.name, pair.bob.name, etherToSend);
      // check balances
      const aliceBalance = yield rest.getBalance(alice.address, ACCOUNT_INDEX, node.id);
      const bobBalance = yield rest.getBalance(bob.address, ACCOUNT_INDEX, node.id);
      bobBalance.should.be.bignumber.eq(FAUCET_AWARD.plus(delta));
    }
  }

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
    const receipt = yield rest.send(alice, bob, etherToSend);
    const txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');
    // check balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.endBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.endBalance = new BigNumber(bob.accounts[0].balance);

    //TODO Calculate gas cost and factor into balance
    const delta = new BigNumber(etherToSend).mul(constants.ETHER);
    assert.isOk(alice.startingBalance.minus(delta).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(delta).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
  });
});
