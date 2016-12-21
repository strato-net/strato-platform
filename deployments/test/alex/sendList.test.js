const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = require('bignumber.js');

describe.skip('Bloc - Single 2', function() {
  this.timeout(40 * 1000);

  const scope = {};
  const alice = util.uid('Alice');
  const bob = util.uid('Bob');
  const password = '1234';

  // create the users
  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(alice, password))
      .then(rest.createUser(bob, password))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  // sanity check - 1 tx
  it('should send 1 tx', function(done) {
    const aliceAddress = scope.users[alice].address;
    rest.setScope(scope)
      .then(rest.getBalance(aliceAddress))
      .then(rest.send(alice, bob, 1.0))
      .then(rest.getBalance(aliceAddress))
      .then(function(scope) {
        console.log(scope.balances[aliceAddress]);
        var balances = scope.balances[aliceAddress];
        const diff = new BigNumber(balances[1]).minus(balances[0]);
        console.log(balances, diff);
        done();
      }).catch(done);
  });
});


// === SKIP ===
describe.skip('Bloc - List', function() {
  this.timeout(90 * 1000);

  const scope = {};
  const alice = util.uid('Alice');
  const bob = util.uid('Bob');
  const password = '1234';
  const txs = [];

  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(alice, password))
      .then(rest.createUser(bob, password))
      .then(function(scope) {
        const bobAddress = scope.users[bob].address;
        txs.push({
          "toAddress": bobAddress,
          "value": ""
        });
        txs.push({
          "toAddress": bobAddress,
          "value": "1"
        });
        done();
      }).catch(done);
  });

  it('should send 1 tx', function(done) {
    rest.setScope(scope)
      .then(rest.send(alice, bob, 1.0))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  it('should send list - no resolve', function(done) {
    const txresolve = false;
    rest.setScope(scope)
      .then(rest.sendList(alice, txs, txresolve))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  it('should send list - with resolve', function(done) {
    const txresolve = true;
    rest.setScope(scope)
      .then(rest.sendList(alice, txs, txresolve))
      .then(function(scope) {
        done();
      }).catch(done);
  });

});


describe('Bloc - List', function() {
  this.timeout(9990 * 1000);

  const scope = {};
  const alice = util.uid('Alice');
  const bob = util.uid('Bob');
  const password = '1234';
  const txs = [];

  const txCount = 3;
  const txValue = 1 ; // Ether

  // create user
  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(alice, password))
      .then(rest.createUser(bob, password))
      .then(function(scope) {
        // create the tx list
        const bobAddress = scope.users[bob].address;
        for (var i = 0; i < txCount; i++) {
          txs.push({
            "toAddress": bobAddress,
            "value": txValue,
          });
        }
        done();
      }).catch(done);
  });

  // 1 tx to calculate the fee
  it('should send 1 tx', function(done) {
    rest.setScope(scope)
      .then(rest.send(alice, bob, 0.001))
      .then(function(scope) {
        const result = scope.tx.slice(-1)[0].result;
        scope.fee = new BigNumber(result.gasLimit).times(new BigNumber(result.gasPrice));
        done();
      }).catch(done);
  });

  // send the list
  it('should send list - with resolve ' + txCount + ' transactions', function(done) {
    const txresolve = true;
    const aliceAddress = scope.users[alice].address;
    rest.setScope(scope)
      .then(rest.getBalance(aliceAddress))
      .then(rest.sendList(alice, txs, txresolve))
      .then(rest.getBalance(aliceAddress))
      .then(function(scope) {
        // assert the final balance
        prettyBalance(scope.balances[aliceAddress]);
        const listTxFee = scope.fee.mul(txCount);
        const listTxValue = new BigNumber(txValue).mul(common.constants.ETHER).mul(txCount);
        const listTotal = listTxValue.add(listTxFee);

        const balanceAfter = scope.balances[aliceAddress].slice(-1)[0];
        const balanceBefore = scope.balances[aliceAddress].slice(-2)[0];
        const balanceDiff = balanceBefore.minus(balanceAfter);

        balanceDiff.should.be.bignumber.equal(listTotal);

        done();
      }).catch(done);
  });
});


function prettyBalance(balances) {
  console.log('balances');
  for (var i = 0; i < balances.length; i++) {
    var b = new BigNumber(balances[i]);
    var format = common.constants.formatWei(b);
    var diff = '';
    if (i > 0) {
      diff = '(' + common.constants.formatWei(b.minus(balances[i - 1])) + ')';
    }
    console.log(i, format, diff);
  }
}
