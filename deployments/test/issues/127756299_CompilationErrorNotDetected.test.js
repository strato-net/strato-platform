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

describe('127756299_CompilationErrorNotDetected ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const errorNone = new Contract('D', './fixtures/contracts/ErrorNone.sol');
  const errorYes = new Contract('D', './fixtures/contracts/ErrorYes.sol');

  itShould.importAndUploadBlob(alice, errorNone);
  itShould.importAndUploadBlob(alice, errorYes);

});
