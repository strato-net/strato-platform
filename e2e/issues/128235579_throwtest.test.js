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

describe('128235579_throwtest', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('ThrowTest', './fixtures/rai/contracts/test/ThrowTest.sol');
  itShould.importAndUploadBlob(alice, contract);
  it('should have a valid contract address', function(done) {
    assert.ok(util.isAddress(contract.address), 'should be a valid address ' + contract.address);
    done();
  });

  const callRun1 = new Call('run', {a:1});
  itShould.callMethod(alice, contract, callRun1);
  it('should return null (success)', function(done) {
    assert.equal(callRun1.result, 'null', 'method call result');
    done();
  });

  const callRun2 = new Call('run', {a:-1});
  itShould.callMethod(alice, contract, callRun2);
  it('should throw error', function(done) {
  	assert.equal(callRun2.result, 'throw', 'Caught error');
    done();
  });

});
