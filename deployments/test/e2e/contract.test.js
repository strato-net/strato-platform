const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const should = common.should;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;


describe('Contract ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('SimpleStorage', 'fixtures/SimpleStorage.sol');

  itShould.importAndUploadBlob(alice, contract);
  it('should have a valid contract address', function(done) {
    assert.ok(util.isAddress(contract.address), 'should be a valid address ' + contract.address);
    done();
  });
  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    const fieldName = 'storedData';
    assert.ok((contract.state.xabi.vars[fieldName] !== undefined), 'should have field ' + fieldName);
    done();
  });
  // arg name should be x
  const argValue = 17;
  const callSet = new Call('set', {x:argValue});
  itShould.callMethod(alice, contract, callSet);
  it('should return null (success)', function(done) {
    assert.equal(callSet.result, 'null', 'method call result');
    done();
  });

  const callGet = new Call('get');
  itShould.callMethod(alice, contract, callGet);
  it('should return ' + argValue, function(done) {
    assert.equal(callGet.result, argValue.toString(), 'calling method get result');
    done();
  });

});
