const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const BigNumber = common.BigNumber;
const path = require('path');

describe('string data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeString";
  const contractFilename = path.join(config.contractsPath, "DataTypeString.sol");
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


  it('setArray (string, count) / getArray(index) returns (string)', function* () {
    // set array
    const methodName = 'setArray';
    const resultArray = ['test', 'test', 'test'];
    const args = {
      value: 'test',
      count: 3
    };

    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, resultArray, 'after calling setArray (string[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray', {index: 1});
    const result = returnsArray[0];
    assert.deepEqual(result, resultArray[1], 'after calling getArray()');
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
    const args = {
      value: 'namaste',
      arrayValue: 'ola',
      count: 3
    };
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    assert.equal(returnsArray[0], args.value);
    assert.equal(returnsArray[1], args.count);

    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(state.storedStruct.values, ['ola','ola','ola']);
  });

  it('setStructArray(string, string, int)', function* () {
    const methodName = 'setStructArray';
    const args = {
      value: 'namaste',
      arrayValue: 'ola',
      count: 3
    };
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state

    const state = yield rest.getState(contract);
    assert.equal(state.storedStructs.length, args.count, "Struct Array should have expected # of elements");
    state.storedStructs.map(function(storedStruct, i) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, ['ola','ola','ola']);
    });
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
