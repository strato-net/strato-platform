const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const User = common.model.User;
const Contract = common.model.Contract;
const itShould = common.itShould;

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('125980693_ContractUpload', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('SimpleStorage', 'fixtures/SimpleStorage.sol');
  itShould.importAndUploadBlob(alice, contract);

  it('should reject non-string contracts (not crash)', function(done) {
    return api.bloc.contract({
        password: config.password,
        src: contract.buffer,
      }, alice.name, alice.address)
      .then(util.forceError(done))
      .catch(util.isValidRejection(done));
  });
});
