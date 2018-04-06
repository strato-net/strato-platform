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

describe('125983817_BadArgName', function() {
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

  // using a non existing arg name - should not crash
  it('should reject an unknown arg name (not crash)', function(done) {
    return api.bloc.method({
        password: config.password,
        method: 'set',
        args: {
          xyz: argValue,
        },
        value: 0.1,
      }, alice.name, alice.address, contract.name, contract.address)
      .then(util.forceError(done))
      .catch(util.isValidRejection(done));
  });
});
