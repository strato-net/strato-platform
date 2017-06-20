const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');


describe('Contract Test',function() {
  this.timeout(config.timeout);

  const username = util.uid('TEST');
  const password = '1234';
  const contractName = "SimpleStorage";
  const contractFilename = "SimpleStorage.sol";
  const simpleStorageCodeHash = '989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8';

  it('should compile a single contract', function(done){
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username,password))
      .then(rest.getContractString(contractName, path.join(config.contractsPath, contractFilename)))
      .then(rest.compile([{contractName, searchable: []}]))
      .then(function(scope) {
        const results = scope.compile[scope.compile.length-1];
        assert.equal(results[0].codeHash, simpleStorageCodeHash, 'Contract codeHash should be consistent');
        done();
      })
      .catch(done);
  });

  it('should upload a single contract', function(done){
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username,password))
      .then(rest.getContractString(contractName, path.join(config.contractsPath, contractFilename)))
      .then(rest.uploadContract(username, password, contractName))
      .then(function(scope) {
        assert.isOk(util.isAddress(scope.contracts[contractName].address), 'Contract should have address after upload');
        done();
      })
      .catch(done);
  });

  const sampleContractName = "Sample";
  const sampleContractFilename = "Sample.sol";
  const sampleContractArgs = {
    _buid : 1,
    _wellname: "well",
    _sampletype: "soil",
    _currentlocationtype: "water",
    _currentvendor: "WalMart",
    _startdepthfeet: 10,
    _enddepthfeet: 12,
    _startdepthmeter: 13,
    _enddepthmeter:14
  };
  it('should upload a contract with a constructor and arguments', function(done){
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username,password))
      .then(rest.getContractString(sampleContractName, path.join(config.contractsPath, sampleContractFilename)))
      .then(rest.uploadContract(username, password, sampleContractName, sampleContractArgs))
      .then(rest.getState(sampleContractName))
      .then(function(scope) {
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

  const simpleIntStorage = "SimpleIntStorage";
  const simpleIntStorageFilename = "SimpleIntStorage.sol";
  const simpleIntStorageArgs = {_storedData: 4};
  const getMethodName = 'get';
  const setMethodName = 'set';
  const getDatum = 'getDatum';
  const getDatumHalves = 'getDatumHalves';
  const getFirst2 = 'getFirst2';
  it('should compile a single contract', function(done){
    const scope = {};
    rest
      .setScope(scope)
      .then(rest.createUser(username,password))
      .then(rest.getContractString(simpleIntStorage, path.join(config.contractsPath, simpleIntStorageFilename)))
      .then(rest.uploadContract(username, password, simpleIntStorage, simpleIntStorageArgs))
      .then(function(scope) {
        assert.isOk(util.isAddress(scope.contracts[simpleIntStorage].address), "contract should have an address");
        return scope;
      })
      .then(rest.callMethod(username, simpleIntStorage, getMethodName, {}))//Get storedData, which was set in constructor
      .then(function(scope){
        assert.equal(simpleIntStorageArgs._storedData, scope.contracts[simpleIntStorage].calls[getMethodName], "constructor argument should be as expected");
        simpleIntStorageArgs._storedData = 10; //Change this data for the 'set' call
        return scope;
      })
      .then(rest.callMethod(username, simpleIntStorage, setMethodName, simpleIntStorageArgs)) //Change the value of storedData to 10
      .then(rest.callMethod(username, simpleIntStorage, setMethodName, {ind: 0, value: 1})) // Set the first value in the array
      .then(rest.getState(simpleIntStorage))
      .then(function(scope) {
        assert.equal(scope.states[simpleIntStorage].storedData, simpleIntStorageArgs._storedData, "argument to set call (for instance member) should change contract state");
        assert.equal(scope.states[simpleIntStorage].storedDatum[0], 1, "argument to set call (for array) should change contract state");
      })
      .then(rest.callMethod(username, simpleIntStorage, setMethodName, {ind: 1, value: 2})) // Set the second value in the array
      .then(rest.callMethod(username, simpleIntStorage, getFirst2, {})) // Get the Tuple
      .then(rest.callMethod(username, simpleIntStorage, getDatum, {})) // Get the storedDatum
      .then(rest.callMethod(username, simpleIntStorage, getDatumHalves, {})) // Get 2 arrays returned in a tuple
      .then(rest.getState(simpleIntStorage))
      .then(function(scope) {
        assert.equal(scope.contracts[simpleIntStorage].calls[getFirst2], [1,2], "argument to get call (for tuple) should return expected values");
        assert.equal(scope.contracts[simpleIntStorage].calls[getDatum], [1,2], "argument to get call (for array) should return expected values");
        assert.equal(scope.contracts[simpleIntStorage].calls[getDatumHalves], [[1],[2]], "argument to get call (for tuple of arrays) should return expected values");
        done();
      })
      .catch(done);
  });

});
