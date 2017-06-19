const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const BigNumber = common.BigNumber;
const constants = common.constants;
const assert = common.assert;

describe('User Test',function() {
  this.timeout(config.timeout);
  const scope = {}

  const username = util.uid('TEST');
  const password = '1234';
  const expectedBalance = new BigNumber(1000).times(constants.ETHER);
  it('should create and faucet a user acc', function(done){
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(function(scope) {
        return rest.getAccount(scope.users[username].address)(scope);
      })
      .then(function(scope) {
        const address = scope.users[username].address;
        assert.isOk(util.isAddress(address), 'the address should be valid');
        const balance = new BigNumber(scope.accounts[address][0].balance);
        assert.isOk(balance.equals(expectedBalance), 'the balance should be equal to 1000 ether');
        done();
      })
      .catch(done);
  })
})
