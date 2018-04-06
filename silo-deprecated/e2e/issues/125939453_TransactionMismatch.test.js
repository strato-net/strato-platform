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

describe('125939453_TransactionMismatch', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  const bob = new User(util.uid('Bob'));
  const expectedBalance = new BigNumber(1000).times(constants.ETHER);

  itShould.createUser(alice);
  itShould.getBalance(alice);
  it('should have balance of ' + expectedBalance, function(done) {
    alice.balance.should.be.bignumber.equal(expectedBalance);
    done();
  });
  itShould.createUser(bob);
  itShould.getBalance(bob);
  it('should have balance of ' + expectedBalance, function(done) {
    bob.balance.should.be.bignumber.equal(expectedBalance);
    done();
  });

  const tx1 = new Tx(alice, bob, 20);
  itShould.send(tx1);
  it('should find the same value', function(done) {
    const sentValue = new BigNumber(tx1.valueEther).times(constants.ETHER);
    const reportedValue = new BigNumber(tx1.result.value);
    reportedValue.should.be.bignumber.equal(sentValue);
    done();
  });

  const tx2 = new Tx(alice, bob, 200);
  itShould.send(tx2);
  it('should find the same value', function(done) {
    const sentValue = new BigNumber(tx2.valueEther).times(constants.ETHER);
    const reportedValue = new BigNumber(tx2.result.value);
    reportedValue.should.be.bignumber.equal(sentValue);
    done();
  });

  const tx3 = new Tx(alice, bob, 2000);
  itShould.send(tx3);
  it('should find the same value', function(done) {
    const sentValue = new BigNumber(tx3.valueEther).times(constants.ETHER);
    const reportedValue = new BigNumber(tx3.result.value);
    reportedValue.should.be.bignumber.equal(sentValue);
    done();
  });

});
