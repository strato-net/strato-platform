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


describe('120461499_ImportAndUpload - smoke', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('A', './fixtures/import/regular/a.sol');
  itShould.importAndUploadBlob(alice, contract);

  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });

  const testCall = new Call('test', {}, 'A');
  itShould.callMethod(alice, contract, testCall);
  it('should return ' + testCall.expected, function(done) {
    assert.equal(testCall.result, testCall.expected, 'should return the expected value');
    done();
  });
});

describe('120461499_ImportAndUpload - BLOB - regular ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('B', './fixtures/import/regular/b.sol');
  itShould.importAndUploadBlob(alice, contract);

  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });

  const testCall = new Call('test', {}, 'A');
  itShould.callMethod(alice, contract, testCall);
  it('should return ' + testCall.expected, function(done) {
    assert.equal(testCall.result, testCall.expected, 'should return the expected value');
    done();
  });
});

describe('120461499_ImportAndUpload - BLOB - transitive ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('C', './fixtures/import/transitive/c.sol');
  itShould.importAndUploadBlob(alice, contract);

  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });

  const testCall = new Call('test', {}, 'A');
  itShould.callMethod(alice, contract, testCall);
  it('should return ' + testCall.expected, function(done) {
    assert.equal(testCall.result, testCall.expected, 'should return the expected value');
    done();
  });
});

describe('120461499_ImportAndUpload - BLOB - relative ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('A', './fixtures/import/relative/a.sol');
  itShould.importAndUploadBlob(alice, contract);

  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });
});

describe('120461499_ImportAndUpload - BLOB - circular ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const contract = new Contract('A', './fixtures/import/circular/a.sol');
  itShould.importAndUploadBlob(alice, contract);

  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });
});

describe.only('120461499_ImportAndUpload - RAI ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const sampleFsm = new Contract('SampleFsm', './fixtures/contracts/SampleFsm.sol');
  const sample = new Contract('Sample', './fixtures/contracts/Sample.sol', {sampleFsmAddr: 1234567890, _buid:1234, _wellId: 13});

  itShould.importAndUploadBlob(alice, sampleFsm);
  // pass the FSM address to Sample
  it('should have a valid contract address', function(done) {
    sample.args.sampleFsmAddr = sampleFsm.address;
    done();
  });

  itShould.importAndUploadBlob(alice, sample);

  itShould.getAbi(sample);
  it('should have a valid contract state', function(done) {
    assert.equal(sample.state.name, sample.name, 'should have the right name');
    console.log(sample.state.xabi.vars);
    done();
  });
});

describe.skip('120461499_ImportAndUpload - regular import ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const filename = 'fixtures/import/regular/b.sol';

  it('should import the contract', function(done) {
    return importer.getDescriptor(filename).then(function(descriptorObject) {
      api.bloc.import({
          password: config.password,
          src: descriptorObject,
        }, alice.name, alice.address)
        .then(function(address) {
          console.log("import: contract address", address);
          done();
        })
        .catch(done);
    });
  });
});
