const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Storage = common.model.Storage;
const Call = common.model.Call;
const Tx = common.model.Tx;
const BigNumber = common.BigNumber;
const importer = require('../lib/importer');

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('Storage operations ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  var id = 10 * process.hrtime()[1]
  var value1 = id + 1;
  var value2 = id + 2;

  const contract1 = new Contract('Storage', './fixtures/contracts/Storage.sol', {_key:id, _value: value1});
  const contract2 = new Contract('Storage', './fixtures/contracts/Storage.sol', {_key:id, _value: value2});

  itShould.importAndUploadBlob(alice, contract1);
  itShould.getState(contract1);
  it('should have a valid contract stateRoute', function(done) {
    assert.equal(contract1.state.key, id);
    assert.equal(contract1.state.value, value1);
    done();
  });

  itShould.importAndUploadBlob(alice, contract2);
  itShould.getState(contract2);
  it('should have a valid contract stateRoute', function(done) {
    assert.equal(contract2.state.key, id);
    assert.equal(contract2.state.value, value2);
    done();
  });

  const storage = new Storage('value', id);
  itShould.getStorage(storage);
  it('should have valid storage values', function(done) {
    assert.equal(storage.result.length, 2, 'result should contain 2 items');
    assert.equal(parseInt('0x' +storage.result[0].value), id, 'result should contain right value');
    assert.equal(parseInt('0x' +storage.result[1].value), id, 'result should contain right value');
    assert.equal(storage.result[0].address, contract1.address, 'result should contain right value');
    assert.equal(storage.result[1].address, contract2.address, 'result should contain right value');
    done();
  });

  for (i=0; i < 10; i++) {
    itShould.getStorage(storage);
  }
});
