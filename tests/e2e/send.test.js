const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;

describe("Send Transaction Test", function() {
  const scope = {}
  const alice = util.uid('Alice');
  const bob = util.uid('Bob');
  const password = '1234';
  const alice_balance = new BigNumber(1000).times(constants.ETHER);
  const bob_balance = new BigNumber(1000).times(constants.ETHER);
  const delta = new BigNumber(10).mul(constants.ETHER);

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
        const alice_address = scope.users[alice].address
        const bob_address = scope.users[bob].address;

        const alice_balance = new BigNumber(scope.accounts[alice_address][0].balance);
        const bob_balance = new BigNumber(scope.accounts[bob_address][0].balance);

        assert.isOk(alice_balance.equals(bob_balance), "balances should be equal before sending ether");
      })
      .then(rest.send(alice, bob, delta))
      .then(function(scope) {
        return rest.getAccount(scope.users[alice].address)(scope);
      })
      .then(function(scope) {
        return rest.getAccount(scope.users[bob].address)(scope);
      })
      .then(function(scope) {
        const alice_address = scope.users[alice].address
        const bob_address = scope.users[bob].address;

        const alice_balance = new BigNumber(scope.accounts[alice_address][0].balance);
        const bob_balance = new BigNumber(scope.accounts[bob_address][0].balance);

        assert.isOk(alice_balance.plus(delta).equals(bob_balance.minus(delta)), "difference in balances should be equal after sending ether");
      })
      .catch(done);
  });

});
