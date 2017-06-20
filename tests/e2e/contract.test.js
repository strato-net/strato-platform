const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');


describe('Contract Test', function () {
  this.timeout(config.timeout);

  const username = util.uid('TEST');
  const password = '1234';
  const contractName = "SimpleStorage";
  const contractFilename = "SimpleStorage.sol";
  const simpleStorageCodeHash = '989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8';

  it('should compile a single contract', function (done) {
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(rest.getContractString(contractName, path.join(config.contractsPath, contractFilename)))
      .then(rest.compile([{contractName, searchable: []}]))
      .then(function (scope) {
        const results = scope.compile[scope.compile.length - 1];
        assert.equal(results[0].codeHash, simpleStorageCodeHash, 'Contract codeHash should be consistent');
        done();
      })
      .catch(done);
  });

  it('should upload a single contract', function (done) {
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(rest.getContractString(contractName, path.join(config.contractsPath, contractFilename)))
      .then(rest.uploadContract(username, password, contractName))
      .then(function (scope) {
        assert.isOk(util.isAddress(scope.contracts[contractName].address), 'Contract should have address after upload');
        done();
      })
      .catch(done);
  });

  const sampleContractName = "Sample";
  const sampleContractFilename = "Sample.sol";
  const sampleContractArgs = {
    _buid: 1,
    _wellname: "well",
    _sampletype: "soil",
    _currentlocationtype: "water",
    _currentvendor: "WalMart",
    _startdepthfeet: 10,
    _enddepthfeet: 12,
    _startdepthmeter: 13,
    _enddepthmeter: 14
  };
  it('should upload a contract with a constructor and arguments', function (done) {
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(rest.getContractString(sampleContractName, path.join(config.contractsPath, sampleContractFilename)))
      .then(rest.uploadContract(username, password, sampleContractName, sampleContractArgs))
      .then(rest.getState(sampleContractName))
      .then(function (scope) {
        const state = scope.states[sampleContractName];
        assert.isOk(util.isAddress(scope.contracts[sampleContractName].address), 'Contract should have address after upload');
        assert.equal(state.buid, sampleContractArgs._buid, "constructor argument buid should be the same");
        assert.equal(state.wellName, sampleContractArgs._wellname, "constructor argument wellName should be the same");
        assert.equal(state.sampleType, sampleContractArgs._sampletype, "constructor argument sampleType should be the same");
        assert.equal(state.currentLocationType, sampleContractArgs._currentlocationtype, "constructor argument currentLocationType should be the same");
        assert.equal(state.currentVendor, sampleContractArgs._currentvendor, "constructor argument currentVendor should be the same");
        assert.equal(state.startDepthFeet, sampleContractArgs._startdepthfeet, "constructor argument startDepthFeet should be the same");
        assert.equal(state.endDepthFeet, sampleContractArgs._enddepthfeet, "constructor argument endDepthFeet should be the same");
        assert.equal(state.startDepthMeter, sampleContractArgs._startdepthmeter, "constructor argument startDepthMeter should be the same");
        assert.equal(state.endDepthMeter, sampleContractArgs._enddepthmeter, "constructor argument endDepthMeter should be the same");
        done();
      })
      .catch(done);
  });
});
