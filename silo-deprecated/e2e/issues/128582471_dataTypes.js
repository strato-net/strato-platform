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

describe('128582471_dataTypes', function() {
  describe('UintArray Test', function() {
    this.timeout(config.timeout);
    itShould.checkAvailability(); // in case bloc crashed on the previous test

    const alice = new User(util.uid('Alice'));

    itShould.createUser(alice);

    const contract = new Contract('UintArray',
                                  'fixtures/datatypes/UintArray.sol',
                                  {value:[1,2]}
                                 );

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

    // return uint[]
    const callGet = new Call('get');

    itShould.callMethod(alice, contract, callGet);
    it('should return uint[]', function(done) {
      assert.equal(callGet.result, '1,2', 'method call result');
      done();
    });

    // return uint[]
    const callSet = new Call('set', [3,4]);

    itShould.callMethod(alice, contract, callSet);
    it('should return null', function(done) {
      assert.equal(callSet.result, 'null', 'method call result');
      done();
    });

    itShould.callMethod(alice, contract, callGet);
    it('should return uint[]', function(done) {
      assert.equal(callGet.result, '3,4', 'method call result');
      done();
    });

    itShould.getState(contract);
    it('should have a valid contract state', function(done) {
      assert.equal(contract.state.val, '3,4', 'should have the right array values');

      done();
    });

    it('should set mapping and key', function(done){
      contract.mapping = 'uintMap';
      contract.key = 0;
      done();
    });

    itShould.getStateMapping(contract);
    it('should have a valid contract state', function(done) {
      // console.log(contract);
      assert.equal(contract.state.uintMap['0'], '1,2', 'should equal the stored array values');
      done();
    });

  });

  describe('EnumArray Test', function() {
    this.timeout(config.timeout);
    itShould.checkAvailability(); // in case bloc crashed on the previous test

    const alice = new User(util.uid('Alice'));

    itShould.createUser(alice);

    const contract = new Contract('EnumArray', 'fixtures/datatypes/EnumArray.sol');

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

    // return enum[]
    const callGet = new Call('get');

    itShould.callMethod(alice, contract, callGet);
    it('should return enum[]', function(done) {
      assert.equal(callGet.result, '1,2', 'method call result');
      done();
    });

    // return enum[]
    const callSet = new Call('set', [3,4]);

    itShould.callMethod(alice, contract, callSet);
    it('should return null', function(done) {
      assert.equal(callSet.result, 'null', 'method call result');
      done();
    });

    itShould.callMethod(alice, contract, callGet);
    it('should return enum[]', function(done) {
      assert.equal(callGet.result, '3,4', 'method call result');
      done();
    });

    // itShould.getState(contract);
    // it('should have a valid contract state', function(done) {
    //   assert.equal(contract.state.val, '3,4', 'should have the right array values');
    //
    //   done();
    // });

  });

  describe('Contract Test', function() {
    this.timeout(config.timeout);
    itShould.checkAvailability(); // in case bloc crashed on the previous test

    const alice = new User(util.uid('Alice'));

    itShould.createUser(alice);

    const contract = new Contract('Contract', 'fixtures/datatypes/Contract.sol');

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

    // return Contract
    const callGet = new Call('get');

    itShould.callMethod(alice, contract, callGet);
    it('should return Contract', function(done) {
      assert(callGet.result.length === 40);
      // assert.equal(callGet.result, '', 'method call result');
      done();
    });

    // return Contract
    const callSet = new Call('set', 'deadbeef');

    itShould.callMethod(alice, contract, callSet);
    it('should return null', function(done) {
      assert.equal(callSet.result, 'null', 'method call result');
      done();
    });

    itShould.callMethod(alice, contract, callGet);
    it('should return enum[]', function(done) {
      assert.equal(callGet.result,  '00000000000000000000000000000000deadbeef', 'method call result');
      done();
    });

    // itShould.getState(contract);
    // it('should have a valid contract state', function(done) {
    //   assert.equal(contract.state.val, '3,4', 'should have the right array values');
    //
    //   done();
    // });

  });
});
