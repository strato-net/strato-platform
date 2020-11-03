const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');
const BigNumber = common.BigNumber;

const adminName = util.uid('Admin');
const adminPassword = '1234';

const contractName = "DataTypeBool";
const contractFilename = path.join(config.contractsPath, "DataTypeBool.sol");
const constructorArgs = {_storedData: true};

describe.skip('bool data type', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(function*() {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the bool storage contract with constructor arguments', function*() {
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (bool)', function*() {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'bool returned from get()');
  });

  it('set (bool)', function*() {
    const methodName = 'set';
    const args = {value: false};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, args.value, 'bool returned from get()');
  });

  it('setArray (bool[]) / getArray() returns (bool[])', function*() {
    // set array
    const methodName = 'setArray';
    const args = {values: [false, true, false]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (bool[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray');
    const result = returnsArray[0];
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(bool, bool, bool) returns (bool, bool, bool)', function*() {
    const methodName = 'getTuple';
    const args = {v1: true, v2: true, v3: false};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = returnsArray;
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'bool,bool,bool returned from getTuple()');
  });

  it('setStruct(bool value, bool[] values) return (bool, bool[])', function*() {
    // function setStruct(bool value, bool[] values) returns (bool, bool[])
    const methodName = 'setStruct';
    const args = {value: false, values: [true, false, true]};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(returnsArray[1], args.values);
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(state.storedStruct.values, args.values);
  });

  it('setStructArray(bool value, bool[] values)', function*() {
    // function setStructArray(bool value, bool[] values)
    const methodName = 'setStructArray';
    const args = {value: true, values: [false, false, true]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStructs.length, 3, "Struct Array should have expected # of elements");
    state.storedStructs.map(function (storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, args.values);
    })
  });

  it('setMapping(bool value, bool key)', function* () {
    // function setMapping(bool value, bool key) returns (bool value)
    const methodName = 'setMapping';
    const args = {value: false, key: true};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = parseBool(returnsArray[0]);
    assert.equal(result, args.value);
  });

  it('call method with value', function*() {
    const methodName = 'get';
    const methodArgs = {};
    const setMethodName = 'set';
    const setMethodArgs = {value: constructorArgs._storedData};
    const etherToSend = 0;

    //Call method with value
    yield rest.callMethod(adminUser, contract, setMethodName, setMethodArgs);
    const resultWithValue = yield rest.callMethod(adminUser, contract, methodName, methodArgs, etherToSend);
    assert.equal(resultWithValue[0], constructorArgs._storedData, "method call with value should execute");

    const contractBalance = yield rest.getBalance(contract.address);
    const expectedBalance = (new BigNumber(etherToSend)).mul(common.constants.ETHER);
    assert.isOk(expectedBalance.equals(contractBalance), "contract balance should equal value from method call");
  });
});

function parseBool(string) {
  return string === "true";
}

function parseBoolArray(arrayOfStrings) {
  return arrayOfStrings.map(function (member) {
    return member === "true";
  });
}

describe('enum data type: illegal values:', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  const illegalValue = [ 'zzz', 'true 1'];
  const expectedStatus = 400;

  illegalValue.map(function(illegalValue) {
    it(`constructor args: '${typeof illegalValue} ${illegalValue}'`, function* () {
      // upload with bad agrs
      const args = {_storedData: illegalValue};
      try {
        yield rest.uploadContract(adminUser, contractName, contractFilename, args);
      } catch(httpError) {
        // expected to throw
        assert.equal(httpError.status, expectedStatus, 'illegal value http status');
        return;
      }
      // error - did not throw
      assert(false, `constructor args: illegal value '${typeof illegalValue} ${illegalValue}' should have thrown ` + expectedStatus);
    });
  });

  illegalValue.map(function(illegalValue) {
    it(`set (enum) illegal value: '${typeof illegalValue} ${illegalValue}'`, function* () {
      const methodName = 'set';
      const args = {value: illegalValue};
      try {
        const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
      } catch(httpError) {
        // expected to throw
        assert.equal(httpError.status, expectedStatus, 'illegal value http status');
        return;
      }
      // error - did not throw
      assert(false, `illegal value '${typeof illegalValue} ${illegalValue}' should have thrown ` + expectedStatus);
    });
  });

  illegalValue.map(function(illegalValue) {
    it(`setArray (enum[]) / getArray() returns (enum[]): illegal value: '${typeof illegalValue} ${illegalValue}'`, function* () {
      // set array
      const methodName = 'setArray';
      const args = {values: [illegalValue, illegalValue, illegalValue]};
      try {
        const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
      } catch(httpError) {
        // expected to throw
        assert.equal(httpError.status, expectedStatus, 'illegal value http status');
        return;
      }
      // error - did not throw
      assert(false, `illegal value '${typeof illegalValue} ${illegalValue}' should have thrown ` + expectedStatus);
    });
  });
});

describe.skip('enum data type: legal values:', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  const values = [ 0, 1, '0', '1', 111, -1, '-1'];

  values.map(function(value) {
    it(`constructor args: '${typeof value} ${value}'`, function* () {
      const args = {_storedData: value};
      contract = yield rest.uploadContract(adminUser, contractName, contractFilename, args);
      const state = yield rest.getState(contract);
      assert.equal(state.storedData, value, 'storedData');
    });
  });

  values.map(function(value) {
    it(`set (bool) '${typeof value} ${value}' `, function*() {
      const methodName = 'set';
      const args = {value: value};
      const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
      const state = yield rest.getState(contract);
      assert.equal(state.storedData, args.value, 'bool returned from get()');
    });
  });

  it('setArray (bool[]) / getArray() returns (bool[])', function*() {
    // set array
    const methodName = 'setArray';
    const args = {values: values};
    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (bool[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray');
    const result = returnsArray[0];
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });
});
