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
const importer = require('../lib/importer');


// ---------------------------------------------------
//   test suites
// ---------------------------------------------------


describe('126762455_ContractInContract - smoke', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('A', './fixtures/import/regular/a.sol');
  itShould.importAndUploadBlob(alice, contract);

  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });

  const testCall = new Call('test', {}, 'A');
  itShould.callMethod(alice, contract, testCall);
  it('should return ' + testCall.expected, function(done) {
    assert.equal(testCall.result, testCall.expected, 'should return the expected value');
    done();
  });
});

describe.only('126762455_ContractInContract - create a contract inside a contract', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);


  const childContract = new Contract('Child', './fixtures/contractInContract/child.sol', {who: "god"});
  itShould.importAndUploadBlob(alice, childContract);
  itShould.getAbi(childContract);
  it('should have a valid contract state', function(done) {
    assert.equal(childContract.state.name, childContract.name, 'should have the right name');
    done();
  });

  const test = new Call('test', {}, 'Child');
  itShould.callMethod(alice, childContract, test);
  it('should return ' + test.expected, function(done) {
    assert.equal(test.result, test.expected, 'should return Child');
    done();
  });

  const parentContract = new Contract('Parent', './fixtures/contractInContract/parent.sol');
  itShould.importAndUploadBlob(alice, parentContract);
  itShould.getAbi(parentContract);
  it('should have a valid contract state', function(done) {
    assert.equal(parentContract.state.name, parentContract.name, 'should have the right name');
    done();
  });

  const getUint = new Call('getUint', {}, '666');
  itShould.callMethod(alice, parentContract, getUint);
  it('should return ' + getUint.expected, function(done) {
    done();
  });

  const getChild = new Call('getChild', {}, 'valid address');
  for(var i = 0; i < 1; i++) {
    itShould.callMethod(alice, parentContract, getChild);
    it('should return ' + getChild.expected, function(done) {
      console.log(getChild.result);
      assert.ok(util.isAddress(getChild.result), 'should return address');
      childContract.address = getChild.result;
      done();
    });

    itShould.callMethod(alice, childContract, test);
    it('should return ' + test.expected, function(done) {
      assert.equal(test.result, test.expected, 'should return Child');
      done();
    });
  }
});
