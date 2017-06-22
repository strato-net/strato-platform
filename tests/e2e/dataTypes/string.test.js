const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('string data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeString";
  const contractFilename = path.join(config.contractsPath, "dataTypes/DataTypeString.sol");
  const constructorArgs = {_storedData: 'test'};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the string storage contract with constructor arguments', function* () {
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (string)', function* () {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'string returned from get()');
  });

  it('set (string)', function* () {
    const methodName = 'set';
    const args = {value: 'test2'};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, args.value, 'string returned from get()');
  });


  it('setArray (string, index) / getArray(index) returns (string)', function* () {
    // set array
    const methodName = 'setArray';
    const resultArray = ['test1', 'test2', 'test3'];
    const args = [
      {value: 'test1', index: 0},
      {value: 'test2', index: 1},
      {value: 'test3', index: 2},
    ]
    yield rest.callMethod(adminUser, contract, methodName, args[0]);
    yield rest.callMethod(adminUser, contract, methodName, args[1]);
    yield rest.callMethod(adminUser, contract, methodName, args[2]);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, resultArray, 'after calling setArray (string[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray', {index: 1});
    const result = returnsArray[0];
    assert.deepEqual(result, args[1].value, 'after calling getArray()');
  });

  it('getTuple(string, string, string) returns (string, string, string)', function* () {
    const methodName = 'getTuple';
    const args = {v1: 'test4', v2: 'test5', v3: 'test6'};
    const result = yield rest.callMethod(adminUser, contract, methodName, args);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'string,string,string returned from getTuple()');
  });


  it('setStruct(string value, string arrayValue, uint index) return (string, string)', function* () {
    // function setStruct(string value, string[] values) returns (string, string[])
    const methodName = 'setStruct';
    const args = [
      {value: 'namaste', arrayValue: 'cest', index: 0},
      {value: 'namaste', arrayValue: 'la', index: 1},
      {value: 'namaste', arrayValue: 'vie', index: 2}
    ];
    const returnsArray1 = yield rest.callMethod(adminUser, contract, methodName, args[0]);
    assert.equal(returnsArray1[0], args[0].value);
    assert.equal(returnsArray1[1], args[0].arrayValue);
    const returnsArray2 = yield rest.callMethod(adminUser, contract, methodName, args[1]);
    assert.equal(returnsArray2[0], args[1].value);
    assert.equal(returnsArray2[1], args[1].arrayValue);
    const returnsArray3 = yield rest.callMethod(adminUser, contract, methodName, args[2]);
    assert.equal(returnsArray3[0], args[2].value);
    assert.equal(returnsArray3[1], args[2].arrayValue);

    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStruct.value, args[0].value);
    assert.deepEqual(state.storedStruct.values, ['cest','la','vie']);
  });

  it('setStructArray()', function* () {
    const methodName = 'setStructArray';
    yield rest.callMethod(adminUser, contract, methodName);
    // check the struct state
    const args = {
      value: 'namaste',
      values: ['cest','la','vie']
    }
    const state = yield rest.getState(contract);
    state.storedStructs.map(function(storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, args.values);
    })
  });

  it('setMapping(string value, string key)', function* () {
    // function setMapping(string value, string key) returns (string value)
    const methodName = 'setMapping';
    const args = {value: '300', key: '301'};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = returnsArray[0];
    assert.equal(result, args.value);
  });

  it('should be able to store and retrieve large strings', function* () {
    const methodName = 'set';
    const value = '0123456789ABCDEF';
    const args = { value };

    while(args.value.length <= 256) {
      const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
      const state = yield rest.getState(contract);
      assert.equal(state.storedData, args.value, 'successfully set and read string of length ' + args.value.length);
      args.value += value;
    }
  });
});
