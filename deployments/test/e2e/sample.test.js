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

describe('Sample operations ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const sampleFsm = new Contract('SampleFsm', './fixtures/contracts/SampleFsm.sol');
  const sample = new Contract('Sample', './fixtures/contracts/Sample.sol');

  itShould.importAndUploadBlob(alice, sampleFsm);
  // pass the FSM address to Sample
  it('should have a valid contract address', function(done) {
    sample.args = {sampleFsmAddr: sampleFsm.address, _buid: 1234, _wellId: 13};
    done();
  });

  itShould.importAndUploadBlob(alice, sample);

  itShould.getAbi(sample);
  it('should have a valid contract state', function(done) {
    assert.equal(sample.state.name, sample.name, 'should have the right name');
    done();
  });

  itShould.getState(sample);
  it('should have a valid contract stateRoute', function(done) {
    assert.equal(sample.state.currentState.key, 'START');
    assert.equal(sample.state.currentState.value, 1);
    assert.equal(sample.state.buid, sample.args._buid);
    done();
  });

  const stateCall = new Call('state', {}, 1);
  itShould.callMethod(alice, sample, stateCall);
  it('should return something', function(done) {
    console.log(stateCall);
    done();
  });

  itShould.callMethod(alice, sample, new Call('update', {eventId: 1}, 2));
  it('should return something', function(done) {
    done();
  });

  itShould.getState(sample);
  it('should have a valid contract stateRoute', function(done) {
     assert.equal(sample.state.currentState.key, 'PLANNED');
     assert.equal(sample.state.currentState.value, 2);
     assert.equal(sample.state.buid, sample.args._buid);
    done();
  });

  itShould.callMethod(alice, sample, new Call('update', {eventId: 2}, 3));
  it('should return something', function(done) {
    done();
  });

  itShould.getState(sample);
  it('should have a valid contract stateRoute', function(done) {
     assert.equal(sample.state.currentState.key, 'COLLECTED');
     assert.equal(sample.state.currentState.value, 3);
     assert.equal(sample.state.buid, sample.args._buid);
    done();
  });

});
