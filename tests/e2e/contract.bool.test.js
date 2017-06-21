const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('SimpleBoolStorage Contract Test', function () {
  this.timeout(config.timeout);

  const username = util.uid('TEST');
  const password = '1234';

  const simpleBoolStorage = "SimpleBoolStorage";
  const simpleBoolStorageFilename = "SimpleBoolStorage.sol";
  const simpleBoolStorageArgs = {_storedData: false};
  const simpleBoolSetArgs = {value: true};
  const getMethodName = 'get';
  const setMethodName = 'set';
  const getArrayMethodName = 'getArray';
  const setArrayMethodName = 'setArray';
  const getDatum = 'getDatum';
  const getDatumHalves = 'getDatumHalves';
  const getFirst2 = 'getFirst2';
  const scope = {};

  before('should upload the boolean storage contract', function (done) {
    assert.isDefined(config.contractsPath !== undefined, 'config should specify contracts path');
    rest
      .setScope(scope)
      .then(rest.createUser(username, password))
      .then(rest.getContractString(simpleBoolStorage, path.join(config.contractsPath, simpleBoolStorageFilename)))
      .then(rest.uploadContract(username, password, simpleBoolStorage, simpleBoolStorageArgs))
      .then(function (scope) {
        assert.isOk(util.isAddress(scope.contracts[simpleBoolStorage].address), "contract should have an address");
        done();
      })
      .catch(done)
  });

  it('should return the storedData given in the constructor', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBoolStorage, getMethodName, {}))//Get storedData, which was set in constructor
      .then(function (scope) {
        assert.equal(simpleBoolStorageArgs._storedData, scope.contracts[simpleBoolStorage].calls[getMethodName][0], "constructor argument should be as expected");
        done();
      })
      .catch(done)
  });

  it('should change the state of the contract with the set/setArray method calls', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBoolStorage, setMethodName, simpleBoolSetArgs)) //Change the value of storedData to 10
      .then(rest.callMethod(username, simpleBoolStorage, setArrayMethodName, {value: true})) // Set the first value in the array
      .then(rest.callMethod(username, simpleBoolStorage, setArrayMethodName, {value: false})) // Set the second value in the array
      .then(rest.callMethod(username, simpleBoolStorage, getMethodName, {}))
      .then(rest.callMethod(username, simpleBoolStorage, getDatum, {}))
      .then(function (scope) {
        console.log(JSON.stringify(scope.contracts[simpleBoolStorage].calls), null, 2);
        assert.equal(scope.contracts[simpleBoolStorage].calls[getMethodName][0], simpleBoolSetArgs.value, "argument to set call (for instance member) should change contract state");
        assert.equal(scope.contracts[simpleBoolStorage].calls[getDatum][0][0], true, "argument to set call (for array) should change contract state");
        done();
      })
      .catch(done)
  });

  it('should return one boolean', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBoolStorage, getArrayMethodName, {ind: 0})) // Get the first value in the array
      .then(rest.getState(simpleBoolStorage))
      .then(function (scope) {
        assert.equal(scope.contracts[simpleBoolStorage].calls[getArrayMethodName][0], true, "argument to set call (for array index 0) should change contract state");
        done();
      })
      .catch(done)
  });

  it('should return a tuple of booleans', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBoolStorage, getFirst2, {})) // Get the Tuple
      .then(function (scope) {
        const calls = scope.contracts[simpleBoolStorage].calls[getFirst2]
        assert.equal(calls[0], true,"argument to get call (for tuple) should return expected value in index 0");
        assert.equal(calls[1], false,"argument to get call (for tuple) should return expected value in index 1");
        done();
      })
      .catch(done);
  });

  it('should return an array of booleans', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBoolStorage, getDatum, {})) // Get the storedDatum
      .then(function (scope) {
        const calls = scope.contracts[simpleBoolStorage].calls[getDatum][0]
        assert.equal(calls[0], true,"argument to get call (for array) should return expected value in index 0");
        assert.equal(calls[1], false,"argument to get call (for array) should return expected value in index 1");
        done();
      })
      .catch(done);
  });

  it('should return a tuple of boolean arrays', function (done) {
    rest
      .setScope(scope)
      .then(rest.callMethod(username, simpleBoolStorage, getDatumHalves, {})) // Get 2 arrays returned in a tuple
      .then(function (scope) {
        const calls = scope.contracts[simpleBoolStorage].calls[getDatumHalves]
        assert.equal(calls[0][0], true,"argument to get call (for tuple of arrays) should return expected value in index [0][0]");
        assert.equal(calls[1][0], false, "argument to get call (for tuple of arrays)  should return expected value in index [1][0]");
        done();
      })
      .catch(done);
  });
});