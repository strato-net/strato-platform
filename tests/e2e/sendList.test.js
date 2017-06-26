const ba = require('blockapps-rest');
require('co-mocha');

const rest = ba.rest;
const common = ba.common;
const util = common.util;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;
const config = common.config;

describe("Send Transaction List", function() {
  this.timeout(config.timeout);

  const password = '1234';

  it('resolve==true', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchSize = 10;
    const batchValueEther = 23;

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send List
    const resolve = true;
    const txs = createBatchTx(batchSize, batchValueEther, bob);
    const receipts = yield rest.sendList(alice, txs, resolve);

    // check balances
    alice.endBalance = yield rest.getBalance(alice.address);
    bob.endBalance = yield rest.getBalance(bob.address);

    //TODO Calculate gas cost and factor into balance
    const delta = new BigNumber(batchValueEther).mul(batchSize).mul(constants.ETHER);
    assert.isOk(alice.startingBalance.minus(delta).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(delta).equals(bob.endBalance), "bob's balance should be as expected after sending ether");

    // const results = [];
    // for (let receipt of receipts) {
    //   console.log(receipt.senderBalance);
    //   const result = yield rest.transactionResult(receipt.senderBalance);
    //   results.push(result[0])
    // }
    // console.log(results);
  });

  it('resolve==false', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchSize = 10;
    const batchValueEther = 23;

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send List
    const resolve = false;
    const txs = createBatchTx(batchSize, batchValueEther, bob);
    const receipts = yield rest.sendList(alice, txs, resolve);

    const results = [];
    for (let receipt of receipts) {
      const result = yield rest.waitTransactionResult(receipt.senderBalance);
      results.push(result[0])
    }
    const failed = results.filter(function (result) {
      return result.status != 'success';
    });
    assert.equal(failed.length, 0, 'some transactions failed ' + JSON.stringify(failed,null,2));

    // check balances
    alice.endBalance = yield rest.getBalance(alice.address);
    bob.endBalance = yield rest.getBalance(bob.address);

    //TODO Calculate gas cost and factor into balance
    const delta = new BigNumber(batchValueEther).mul(batchSize).mul(constants.ETHER);
    assert.isOk(alice.startingBalance.minus(delta).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(delta).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
  });

  it.only('resolve==false, insufficient funds', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchSize = 10;
    const batchValueEther = 230;

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send List
    const resolve = false;
    const txs = createBatchTx(batchSize, batchValueEther, bob);
    const receipts = yield rest.sendList(alice, txs, resolve);

    const results = [];
    for (let receipt of receipts) {
      const result = yield rest.waitTransactionResult(receipt.senderBalance);
      results.push(result[0])
    }
  });

});


function createBatchTx(batchSize, batchValue, toUser) {
  var txs = [];
  for (var i = 0; i < batchSize; i++) {
    txs.push({
      value: batchValue,
      toAddress: toUser.address,
    });
  }
  return txs;
}
