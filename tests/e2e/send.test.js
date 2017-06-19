const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;

describe("Send Transaction Test", function() {
  this.timeout(config.timeout);

  const scope = {}
  const alice = util.uid('Alice');
  const bob = util.uid('Bob');
  const password = '1234';
  const etherToSend = 10;
  const delta = new BigNumber(etherToSend).mul(constants.ETHER);
  const startingBalance = new BigNumber(1000).times(constants.ETHER);

  it("should send correct amount of ether", function(done) {
    rest
      .setScope(scope)
      .then(rest.createUser(alice, password))
      .then(rest.createUser(bob, password))
      .then(function(scope) {
        return rest.getAccount(scope.users[alice].address)(scope);
      })
      .then(function(scope) {
        return rest.getAccount(scope.users[bob].address)(scope);
      })
      .then(function(scope) {
        const aliceAddress = scope.users[alice].address
        const bobAddress = scope.users[bob].address;

        const aliceBalance = new BigNumber(scope.accounts[aliceAddress][0].balance);
        const bobBalance = new BigNumber(scope.accounts[bobAddress][0].balance);

        assert.isOk(aliceBalance.equals(bobBalance), "balances should be equal before sending ether");
        return scope;
      })
      .then(rest.send(alice, bob, etherToSend))
      .then(function(scope) {
        return rest.getAccount(scope.users[alice].address)(scope);
      })
      .then(function(scope) {
        return rest.getAccount(scope.users[bob].address)(scope);
      })
      .then(function(scope) {
        const aliceAddress = scope.users[alice].address
        const bobAddress = scope.users[bob].address;

        const aliceBalance = new BigNumber(scope.accounts[aliceAddress][0].balance);
        const bobBalance = new BigNumber(scope.accounts[bobAddress][0].balance);
        //TODO Calculate gas cost and factor into balance
        assert.isOk(startingBalance.minus(delta).greaterThan(aliceBalance), "alice's balance should be slightly less than expected due to gas costs");
        assert.isOk(startingBalance.plus(delta).equals(bobBalance), "bob's balance should be as expected after sending ether");
        done();
      })
      .catch(done);
  });

});
