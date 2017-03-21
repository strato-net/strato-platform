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

describe('127632337_vm_publish', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('GetSetStorage', 'fixtures/contracts/GetSetStorage.sol');
  itShould.importAndUploadBlob(alice, contract);
  it('should have a valid contract address', function(done) {
    assert.ok(util.isAddress(contract.address), 'should be a valid address ' + contract.address);
    done();
  });

  const callSet = new Call('set');
  itShould.callMethod(alice, contract, callSet);
  it('should return null (success)', function(done) {
    assert.equal(callSet.result, 'null', 'method call result');
    done();
  });

  const callGet = new Call('get');
  itShould.callMethod(alice, contract, callGet);
  it('should return 1', function(done) {
    assert.equal(callGet.result, '1', 'method call result');
    done();
  });

});
