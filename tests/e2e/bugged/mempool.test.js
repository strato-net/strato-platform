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

const password = '1234';
const batchValue = new BigNumber(2).mul(constants.ETHER);

describe("Send Transaction List with nonces", function() {
  this.timeout(config.timeout);

  const testArray = [
    {nonces: [0,1,2,3], expectedStatii: {success:4, unresolved:0, rejected:0} },
    {nonces: [0,1,2,3,4,5,6], expectedStatii: {success:7, unresolved:0, rejected:0} },
    {nonces: [6,5,4,3,2,1,0], expectedStatii: {success:7, unresolved:0, rejected:0} },
    {nonces: [0,1,2, 4], expectedStatii: {success:3, unresolved:1, rejected:0} },
    {nonces: [0,1,2, 4, 4, 4, 3], expectedStatii: {success:5, unresolved:2, rejected:0} },
  ];

  testArray.map(function(test) {
    it(JSON.stringify(test), function* () {
      yield testSendList(test);
    });
  });
});

describe.only("Send Transaction List with nonces", function() {
  this.timeout(config.timeout);

  const testArray = [
    {nonces: [0,1,2,3,3,3], expectedStatii: {success:4, unresolved:2, rejected:0} },
  ];

  testArray.map(function(test) {
    it(JSON.stringify(test), function* () {
      yield testSendList(test);
    });
  });
});


/**

var p1 = lib.ethbase.Crypto.PrivateKey.random();
mkFaucet(p1)
YES mkTest("should do all transactions" , p1, [0,1,2,3,4,5,6], 1, 1, {"Success!":7})

var p2 = lib.ethbase.Crypto.PrivateKey.random();
mkFaucet(p2)
YES mkTest("should reject latter txs with nonces too low - this triggers (#138009465)", p2, [0,1,2,3,4,5,6,7,8,9,9,9,9,9], 1, 1,{"Success!": 10, "Rejected!": 4})

var p3 = lib.ethbase.Crypto.PrivateKey.random();
mkFaucet(p3)
NO mkTest("should timeout on transactions with nonce in the future and missing .to (#137405949)", p3, [1,2,3,4], 0, 1, {"Unresolved!": 4})

var p4 = lib.ethbase.Crypto.PrivateKey.random();
mkFaucet(p4)
YES mkTest("should timeout on transactions with nonce in the future" , p4, [1,2,3,4], 1, 1, {"Unresolved!": 4})

var p5 = lib.ethbase.Crypto.PrivateKey.random();
mkFaucet(p5)
YES mkTest("should not timeout on some transactions with nonce in the future" , p5, [0,1,2,1,4], 1, 1, {"Success!": 3, "Rejected!": 1, "Unresolved!":1})

var p6 = lib.ethbase.Crypto.PrivateKey.random();
mkFaucet(p6)
YES mkTest("should not timeout on transactions with duplicate nonce" , p6, [0,1,1,2,2], 1, 1, {"Success!": 3, "Rejected!": 2})
NO mkTest("transactions should work, if called after rejections" , p6, [0,1,2], 1, 1, {"Success!": 3})

**/



describe("Send Transaction List with nonces", function() {
  this.timeout(config.timeout);

  const testArray = [
    { prompt: 'should do all transactions',
      nonces: [0,1,2,3,4,5,6], expectedStatii: {success:7, unresolved:0, rejected:0} },
    { prompt: 'should reject latter txs with nonces too low - this triggers (#138009465)',
      nonces: [0,1,2,3,4,5,6,7,8,9,9,9,9,9], expectedStatii: {success:10, unresolved:0, rejected:4} },
    { prompt: 'should timeout on transactions with nonce in the future',
      nonces: [1,2,3,4], expectedStatii: {success:0, unresolved:4, rejected:0} },
    { prompt: 'should not timeout on some transactions with nonce in the future',
      nonces: [0,1,2,1,4], expectedStatii: {success:3, unresolved:1, rejected:1} },
    { prompt: 'should not timeout on transactions with duplicate nonce',
      nonces: [0,1,2,3,3,3], expectedStatii: {success:3, unresolved:0, rejected:3} },
  ];

  testArray.map(function(test) {
    it(JSON.stringify(test), function* () {
      yield testSendList(test);
    });
  });

});

function getStatii(results) {
  return {
    success: results.filter(function(result) {
      if (result.length !== undefined)
        return result[0].message == 'Success!';
      return result.message == 'Success!';
    }).length,
    rejected: results.filter(function(result) {
      if (result.length !== undefined)
        return result[0].message.startsWith('Rejected!');
      return result.message.startsWith('Rejected!');
    }).length,
    unresolved: results.filter(function(result) {
      if (result.length !== undefined)
        return result[0].message.startsWith('Unresolved!');
      return result.message.startsWith('Unresolved!');
    }).length,
  }
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

// input: list of tx hashes
// output: array of promises, checking the txResults of those hashes
function checkResults(receipts) {
  return receipts.map(receipt => {
    const hash = receipt.senderBalance;
    return co(rest.waitTransactionResult(hash, 5*1000))
      .catch(function(err) {
        // an HttpError should be thrown
        if (err.status != undefined)
          throw err;
        // timeout error - unresolved
        return({message:'Unresolved!'});
      });
  });
}

function createBatchTxWithNonce(batchValue, toUser, nonces) {
  var txs = [];
  var count = 0;
  return nonces.map(function(nonce) {
    return {
      value: batchValue.plus(count++),
      toAddress: toUser.address,
      txParams: {nonce: nonce},
    };
  });
}

function* testSendList(test) {
  const uid = util.uid();
  const aliceName = 'Alice' + uid;
  const bobName = 'Bob' + uid;
  const alice = yield rest.createUser(aliceName, password);
  const bob = yield rest.createUser(bobName, password);

  // must use BigNumber for balances
  alice.startingBalance = yield rest.getBalance(alice.address);
  bob.startingBalance = yield rest.getBalance(bob.address);
  assert.isOk(alice.startingBalance.equals(bob.startingBalance), "balances should be equal before sending ether");

  // send List
  const resolve = true;
  const txs = createBatchTxWithNonce(batchValue, bob, test.nonces);
  const receipts = yield rest.sendList(alice, txs, resolve);
  const results = yield Promise.all(checkResults(receipts));
  const statii = getStatii(results);
  assert.deepEqual(statii, test.expectedStatii);

  // check balances
  alice.endBalance = yield rest.getBalance(alice.address);
  bob.endBalance = yield rest.getBalance(bob.address);

  //TODO Calculate gas cost and factor into balance
  const delta = new BigNumber(batchValue).mul(test.expectedStatii.success);
  assert.isOk(alice.startingBalance.minus(delta).greaterThan(alice.endBalance), "alice's balance should be slightly less than expected due to gas costs");
  assert.isOk(bob.startingBalance.plus(delta).equals(bob.endBalance), "bob's balance should be as expected after sending ether");
}
