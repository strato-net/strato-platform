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
    const batchSize = 5;
    const batchValueEther = 1;

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
  });

  it('resolve==false', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchSize = 5;
    const batchValueEther = 1;

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

  it.skip('resolve==false, insufficient funds https://blockapps.atlassian.net/browse/API-12', function* () {
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


function createBatchTx(batchSize, batchValue, toUser, nonce) {
  var txs = [];
  for (var i = 0; i < batchSize; i++) {
    txs.push({
      value: batchValue,
      toAddress: toUser.address,
      txParams: {nonce: nonce+i},
    });
  }
  return txs;
}

function createBatchTxWithNonce(batchValue, toUser, nonces) {
  var txs = [];
  return nonces.map(function(nonce) {
    return {
      value: batchValue,
      toAddress: toUser.address,
      txParams: {nonce: nonce},
    };
  });
}

describe("Send Transaction List with nonces", function() {
  this.timeout(config.timeout);

  const password = '1234';

  it('resolve==true', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchValueEther = 2;

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send List
    const resolve = true;
    const nonces = [0, 1, 2];
    const txs = createBatchTxWithNonce(batchValueEther, bob, nonces);
    const receipts = yield rest.sendList(alice, txs, resolve);

    // check balances
    alice.endBalance = yield rest.getBalance(alice.address);
    bob.endBalance = yield rest.getBalance(bob.address);

    //TODO Calculate gas cost and factor into balance
    const delta = new BigNumber(batchValueEther).mul(nonces.length).mul(constants.ETHER);
    assert.isOk(alice.startingBalance.minus(delta).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
    assert.isOk(bob.startingBalance.plus(delta).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
  });

  it('resolve==false, list of nonces', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchValueEther = 2;

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);

    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");
    // send List
    const resolve = false;
    const nonces = [0, 1, 2];
    const txs = createBatchTxWithNonce(batchValueEther, bob, nonces);
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

  });

  it('resolve==false, nonces and expected results', function* () {
    const uid = util.uid();
    const aliceName = 'Alice' + uid;
    const bobName = 'Bob' + uid;
    const alice = yield rest.createUser(aliceName, password);
    const bob = yield rest.createUser(bobName, password);
    const batchValueEther = 2;

    // must use BigNumber for balances
    alice.startingBalance = yield rest.getBalance(alice.address);
    bob.startingBalance = yield rest.getBalance(bob.address);
    assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");

    // send List
    const resolve = false;
    const nonces = [0, 1, 2];
    const txs = createBatchTxWithNonce(batchValueEther, bob, nonces);
    const receipts = yield rest.sendList(alice, txs, resolve);
    const results = yield waitTransactionResult(receipts);
    const failed = results.filter(statusNotSuccess);
    assert.equal(failed.length, 0, 'some transactions failed ' + JSON.stringify(failed,null,2));
  });

  const listOfNonces = [
    [0,1,2,3],
    [0,1,2,3,4,5,6],
    [6,5,4,3,2,1,0],
  ];

  listOfNonces.map(function(nonces) {
    it('resolve==false ' + nonces, function* () {
      const uid = util.uid();
      const aliceName = 'Alice' + uid;
      const bobName = 'Bob' + uid;
      const alice = yield rest.createUser(aliceName, password);
      const bob = yield rest.createUser(bobName, password);
      const batchValueEther = 2;

      // must use BigNumber for balances
      alice.startingBalance = yield rest.getBalance(alice.address);
      bob.startingBalance = yield rest.getBalance(bob.address);
      assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");

      // send List
      const resolve = false;
      const txs = createBatchTxWithNonce(batchValueEther, bob, nonces);
      const receipts = yield rest.sendList(alice, txs, resolve);
      const results = yield waitTransactionResult(receipts);
      const failed = results.filter(statusNotSuccess);
      assert.equal(failed.length, 0, 'some transactions failed ' + JSON.stringify(failed,null,2));
    });
  });

});

function* waitTransactionResult(receipts) {
  const results = [];
  for (let receipt of receipts) {
    const result = yield rest.waitTransactionResult(receipt.senderBalance);
    results.push(result[0])
  }
  return results;
}

function statusNotSuccess(result) {
  return result.status != 'success';
}

/*
"status": {
      "stage": "Validation",
      "queue": "Incoming",
      "expectation": 21000,
      "type": "InsufficientFunds",
      "reality": 0
    },

*/
function txStatus(result) {
  if (result.status == 'success')
    return 'success';
  return result.status.type;
}
