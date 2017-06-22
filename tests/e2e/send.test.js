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
  const aliceName = 'Alice' + uid;
  const bobName = 'Bob' + uid;
  const password = '1234';
  const etherToSend = 8;

  it('should send correct amount of ether', function* () {
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.startingBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.startingBalance = new BigNumber(bob.accounts[0].balance);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send
    const txResult = yield rest.send(alice, bob, etherToSend);

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


describe("Send Transaction Test", function() {
  this.timeout(config.timeout);

  const uid = util.uid();
  const aliceName = 'Alice' + uid;
  const bobName = 'Bob' + uid;
  const password = '1234';
  const etherToSend = 8;

  it('should send correct amount of ether', function* () {
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send
    const txResult = yield rest.send(alice, bob, etherToSend);

    alice.endBalance = yield rest.getBalance(alice.address);
    bob.endBalance = yield rest.getBalance(bob.address);

    //TODO Calculate gas cost and factor into balance
    const delta = new BigNumber(etherToSend).mul(constants.ETHER);
    assert.isOk(alice.startingBalance.minus(delta).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(delta).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
  });
});
