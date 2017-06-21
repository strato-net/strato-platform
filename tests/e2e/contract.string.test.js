const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('SimpleStringStorage Contract Test', function () {
  this.timeout(config.timeout);

  const username = util.uid('TEST');
  const password = '1234';

  const simpleBytesStorage = "SimpleBytesStorage";
  const simpleBytesStorageFilename = "SimpleBytesStorage.sol";
  const simpleBytesStorageArgs = {value: "four"};
  const simpleBytesSetArgs = {value: "ten"};
  const getMethodName = 'get';
  const setMethodName = 'set';
  const getArrayMethodName = 'getArray';
  const setArrayMethodName = 'setArray';
  const getDatum = 'getDatum';
  const getDatumHalves = 'getDatumHalves';
  const getFirst2 = 'getFirst2';
  const scope = {};

  it('should upload the bytes32 storage contract', function (done) {
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(rest.getContractString(simpleBytesStorage, path.join(config.contractsPath, simpleBytesStorageFilename)))
      .then(rest.uploadContract(username, password, simpleBytesStorage, simpleBytesStorageArgs))
      .then(function (scope) {
        assert.isOk(util.isAddress(scope.contracts[simpleBytesStorage].address), "contract should have an address");
        done();
      })
      .catch(done)
  });

  it('should return the storedData given in the constructor', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBytesStorage, getMethodName, {}))//Get storedData, which was set in constructor
      .then(function (scope) {
        const result = scope.contracts[simpleBytesStorage].calls[getMethodName][0];
        assert.equal(result, util.fromBytes32(simpleBytesStorageArgs.value), "constructor argument should be as expected");
        done();
      })
      .catch(done)
  });

  it('should change the state of the contract with the set/setArray method calls', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBytesStorage, setMethodName, simpleBytesSetArgs)) //Change the value of storedData to 10
      .then(rest.callMethod(username, simpleBytesStorage, setArrayMethodName, {value: "one"})) // Set the first value in the array
      .then(rest.getState(simpleBytesStorage))
      .then(function (scope) {
        const state = scope.states[simpleBytesStorage];
        assert.equal(state.storedData, simpleBytesSetArgs.value, "argument to set call (for instance member) should change contract state");
        assert.equal(state.storedDatum[0], "one", "argument to set call (for array) should change contract state");
        done();
      })
      .catch(done)
  });

  it('should return one string', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBytesStorage, getArrayMethodName, {ind: 0})) // Set the first value in the array
      .then(rest.getState(simpleBytesStorage))
      .then(function (scope) {
        assert.equal(scope.contracts[simpleBytesStorage].calls[getArrayMethodName], "one", "argument to set call (for instance member) should change contract state");
        done();
      })
      .catch(done)
  });

  it('should return a tuple of bytes32', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBytesStorage, setArrayMethodName, {value: "two"})) // Set the second value in the array
      .then(rest.callMethod(username, simpleBytesStorage, getFirst2, {})) // Get the Tuple
      .then(function (scope) {
        const calls = scope.contracts[simpleBytesStorage].calls[getFirst2]
        assert.equal("one", calls[0], "argument to get call (for tuple) should return expected value in index 0");
        assert.equal("two", calls[1], "argument to get call (for tuple) should return expected value in index 1");
        done();
      })
      .catch(done);
  });

  it('should return an array of bytes32', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBytesStorage, getDatum, {})) // Get the storedDatum
      .then(function (scope) {
        const calls = scope.contracts[simpleBytesStorage].calls[getDatum][0]
        assert.equal("one", calls[0], "argument to get call (for array) should return expected value in index 0");
        assert.equal("two", calls[1], "argument to get call (for array) should return expected value in index 1");
        done();
      })
      .catch(done);
  });

  it('should return a tuple of bytes32 arrays', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBytesStorage, getDatumHalves, {})) // Get 2 arrays returned in a tuple
      .then(function (scope) {
        const calls = scope.contracts[simpleBytesStorage].calls[getDatumHalves]
        assert.equal("one", calls[0], "argument to get call (for tuple of arrays) should return expected value in index [0][0]");
        assert.equal("two", calls[1], "argument to get call (for tuple of arrays)  should return expected value in index [1][0]");
        done();
      })
      .catch(done);
  });
});