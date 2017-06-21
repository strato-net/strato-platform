const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('SimpleIntegerStorage Contract Test', function () {
  this.timeout(config.timeout);

  const username = util.uid('TEST');
  const password = '1234';

  const simpleIntStorage = "SimpleIntStorage";
  const simpleIntStorageFilename = "SimpleIntStorage.sol";
  const simpleIntStorageArgs = {_storedData: 4};
  const simpleIntSetArgs = {value: 10};
  const getMethodName = 'get';
  const setMethodName = 'set';
  const getArrayMethodName = 'getArray';
  const setArrayMethodName = 'setArray';
  const getDatum = 'getDatum';
  const getDatumHalves = 'getDatumHalves';
  const getFirst2 = 'getFirst2';
  const scope = {};

  before('should upload the integer storage contract', function (done) {
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(rest.getContractString(simpleIntStorage, path.join(config.contractsPath, simpleIntStorageFilename)))
      .then(rest.uploadContract(username, password, simpleIntStorage, simpleIntStorageArgs))
      .then(function (scope) {
        assert.isOk(util.isAddress(scope.contracts[simpleIntStorage].address), "contract should have an address");
        done();
      })
      .catch(done)
  });

  it('should return the storedData given in the constructor', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleIntStorage, getMethodName, {}))//Get storedData, which was set in constructor
      .then(function (scope) {
        assert.equal(simpleIntStorageArgs._storedData, scope.contracts[simpleIntStorage].calls[getMethodName], "constructor argument should be as expected");
        done();
      })
      .catch(done)
  });

  it('should change the state of the contract with the set/setArray method calls', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleIntStorage, setMethodName, simpleIntSetArgs)) //Change the value of storedData to 10
      .then(rest.callMethod(username, simpleIntStorage, setArrayMethodName, {value: 1})) // Set the first value in the array
      .then(rest.getState(simpleIntStorage))
      .then(function (scope) {
        const state = scope.states[simpleIntStorage];
        assert.equal(state.storedData, simpleIntSetArgs.value, "argument to set call (for instance member) should change contract state");
        assert.equal(state.storedDatum[0], 1, "argument to set call (for array) should change contract state");
        done();
      })
      .catch(done)
  });

  it('should return one integer', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleIntStorage, getArrayMethodName, {ind: 0})) // Set the first value in the array
      .then(rest.getState(simpleIntStorage))
      .then(function (scope) {
        assert.equal(scope.contracts[simpleIntStorage].calls[getArrayMethodName], 1, "argument to set call (for instance member) should change contract state");
        done();
      })
      .catch(done)
  });

  it('should return a tuple of integers', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleIntStorage, setArrayMethodName, {value: 2})) // Set the second value in the array
      .then(rest.callMethod(username, simpleIntStorage, getFirst2, {})) // Get the Tuple
      .then(function (scope) {
        const calls = scope.contracts[simpleIntStorage].calls[getFirst2]
        assert.equal(1, calls[0], "argument to get call (for tuple) should return expected value in index 0");
        assert.equal(2, calls[1], "argument to get call (for tuple) should return expected value in index 1");
        done();
      })
      .catch(done);
  });

  it('should return an array of integers', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleIntStorage, getDatum, {})) // Get the storedDatum
      .then(function (scope) {
        const calls = scope.contracts[simpleIntStorage].calls[getDatum][0]
        assert.equal(1, calls[0], "argument to get call (for array) should return expected value in index 0");
        assert.equal(2, calls[1], "argument to get call (for array) should return expected value in index 1");
        done();
      })
      .catch(done);
  });

  it('should return a tuple of integer arrays', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleIntStorage, getDatumHalves, {})) // Get 2 arrays returned in a tuple
      .then(function (scope) {
        const calls = scope.contracts[simpleIntStorage].calls[getDatumHalves]
        assert.equal(1, calls[0], "argument to get call (for tuple of arrays) should return expected value in index [0][0]");
        assert.equal(2, calls[1], "argument to get call (for tuple of arrays)  should return expected value in index [1][0]");
        done();
      })
      .catch(done);
  });
});