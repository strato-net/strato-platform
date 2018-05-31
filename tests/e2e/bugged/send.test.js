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
  const value = new BigNumber(8).mul(constants.ETHER); // 8 eth in wei

  it('should send correct amount of wei', function* () {
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.startingBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.startingBalance = new BigNumber(bob.accounts[0].balance);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending wei");
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
    assert.isOk(bob.startingBalance.plus(value).equals(bob.endBalance), "bob's balance should be as expected after sending wei");
  });
});

describe("Send Transaction Test", function() {
  this.timeout(config.timeout);

  const uid = util.uid();
  const aliceName = 'Alice' + uid;
  const bobName = 'Bob' + uid;
  const password = '1234';
  const value = new BigNumber(8).mul(constants.ETHER); // 8 eth in wei

  it('should send correct amount of wei', function* () {
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending wei");
    const receipt = yield rest.send(alice, bob, value);
    console.log(receipt.hash)
    const txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');
    // check balances
    alice.endBalance = yield rest.getBalance(alice.address);
    bob.endBalance = yield rest.getBalance(bob.address);

    //TODO Calculate gas cost and factor into balance
    assert.isOk(alice.startingBalance.minus(value).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(value).equals(bob.endBalance), "bob's balance should be as expected after sending wei");
  });

  it('should see insufficient funds', function* () {
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending wei");
    // send
    const weiTooMuch = new BigNumber(2000).mul(constants.ETHER); // 2000 eth in wei
    const receipt = yield rest.send(alice, bob, weiTooMuch.toNumber());
    const txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status.type, 'InsufficientFunds', 'tx status Insufficient Funds');
  });
});

describe.only("Send Transaction - Nonce", function() {
  this.timeout(config.timeout);

  const uid = util.uid();
  const aliceName = 'Alice' + uid;
  const bobName = 'Bob' + uid;
  const password = '1234';
  const value = new BigNumber(8).mul(constants.ETHER); // 8 eth in wei

  it('should send correct amount of wei', function* () {
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);

    // must use BigNumber for balances
    alice.accounts = yield rest.getAccount(alice.address);
    alice.startingBalance = new BigNumber(alice.accounts[0].balance);

    bob.accounts = yield rest.getAccount(bob.address);
    bob.startingBalance = new BigNumber(bob.accounts[0].balance);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending wei");
    // send
    var receipt = yield rest.send(alice, bob, value, 0);
    var txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');

    var receipt = yield rest.send(alice, bob, value, 1);
    var txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');

    var receipt = yield rest.send(alice, bob, value, 2);
    var txResult = yield rest.transactionResult(receipt.hash);
    assert.equal(txResult[0].status, 'success', 'tx status');

    //check balances
    alice.endBalance = yield rest.getBalance(alice.address);
    bob.endBalance = yield rest.getBalance(bob.address);

    //TODO Calculate gas cost and factor into balance
    const total = value.mul(3);
    assert.isOk(alice.startingBalance.minus(total).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(total).equals(bob.endBalance), "bob's balance should be as expected after sending wei");
  });

  it.skip('send with bad nonce', function* () {
  });

});
