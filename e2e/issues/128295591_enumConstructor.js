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

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('128295591_enumConstructor', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('EnumTest', 'fixtures/datatypes/EnumTest.sol', {value:0});
  // const contract = new Contract('EnumTest', 'fixtures/datatypes/EnumTest.sol');
  itShould.importAndUploadBlob(alice, contract);
  it('should have a valid contract address', function(done) {
    assert.ok(util.isAddress(contract.address), 'should be a valid address ' + contract.address);
    done();
  });
  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    const fieldName = 'val';
    assert.isDefined(contract.state.xabi.vars[fieldName], 'should have field ' + fieldName);
    done();
  });

  // return Enum
  const callGet = new Call('get');

  itShould.callMethod(alice, contract, callGet);
  it('should return Enum', function(done) {
    assert.equal(callGet.result, '0', 'method call result');
    done();
  });

  // return Enum
  const callSet = new Call('set', 2);

  itShould.callMethod(alice, contract, callSet);
  it('should return Enum', function(done) {
    assert.equal(callSet.result, 'null', 'method call result');
    done();
  });

  itShould.callMethod(alice, contract, callGet);
  it('should return Enum', function(done) {
    assert.equal(callGet.result, '2', 'method call result');
    done();
  });

  itShould.getState(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.val.key, 'squirtle', 'should have the right enum key');
    assert.equal(contract.state.val.value, '2', 'should have the right enum value');
    assert.equal(contract.state.val.enumType, 'Pokemon', 'should have the right enum type');

    done();
  });

  // it('should set mapping and key', function(done){
  //   contract.mapping = 'numToNum';
  //   contract.key = 0;
  //   done();
  // });
  //
  // itShould.getStateMapping(contract);
  // it('should have a valid contract state', function(done) {
  //   console.log(contract);
  //   // assert.equal(contract.state.val.key, 'squirtle', 'should have the right enum key');
  //   // assert.equal(contract.state.val.value, '2', 'should have the right enum value');
  //   // assert.equal(contract.state.val.enumType, 'Pokemon', 'should have the right enum type');
  //
  //   done();
  // });

});
