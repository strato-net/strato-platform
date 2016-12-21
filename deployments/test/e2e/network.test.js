const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;
const Tx = common.model.Tx;
const BigNumber = common.BigNumber;

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('network', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  const bob = new User(util.uid('Bob'));
  const expectedBalance = new BigNumber(1000).times(constants.ETHER);

  const nodes = config.nodes.length;
  itShould.createUser(alice);
  for (var node = 0; node < nodes; node++) {
    itShould.getBalance(alice, node);
    it('should have balance of ' + expectedBalance, function(done) {
      alice.balance.should.be.bignumber.equal(expectedBalance);
      done();
    });
  }
  itShould.createUser(bob);
  for (var node = 0; node < nodes; node++) {
    itShould.getBalance(bob, node);
    it('should have balance of ' + expectedBalance, function(done) {
      bob.balance.should.be.bignumber.equal(expectedBalance);
      done();
    });
  }

  const tx1 = new Tx(alice, bob, 20);
  itShould.send(tx1);
  it('should find the same value', function(done) {
    const sentValue = new BigNumber(tx1.valueEther).times(constants.ETHER);
    const reportedValue = new BigNumber(tx1.result.value);
    reportedValue.should.be.bignumber.equal(sentValue);
    done();
  });

  const sentValue = new BigNumber(tx1.valueEther).times(constants.ETHER);

  for (var node = 0; node < nodes; node++) {
    itShould.getBalance(bob, node);
    it('should have balance of ' + expectedBalance.plus(sentValue), function(done) {
      bob.balance.should.be.bignumber.equal(expectedBalance.plus(sentValue));
      done();
    });
  }



});
