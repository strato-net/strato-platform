const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('bytes data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeBytes";
  const contractFilename = path.join(config.contractsPath, "dataTypes/DataTypeBytes.sol");
  const constructorArgs = {_storedData: util.toBytes32('test')};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the bytes storage contract with constructor arguments', function* () {
    const state = yield rest.getState(contract);
    assert.equal(util.fromBytes32(state.storedData), util.fromBytes32(args.value), 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (bytes)', function* () {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, util.fromBytes32(result), 'bytes returned from get()');
  });

  it('set (bytes)', function* () {
    const methodName = 'set';
    const args = {value: util.toBytes32('test2')};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, util.fromBytes32(args.value), 'bytes returned from get()');
  });


  it('setArray (bytes, count) / getArray(index) returns (bytes)', function* () {
    // set array
    const methodName = 'setArray';
    const resultArray = [util.toBytes32('test1'), util.toBytes32('test2'), util.toBytes32('test3')];
    const args = {
      value: util.toBytes32('test'),
      count: 3
    };

    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, resultArray, 'after calling setArray (bytes[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray', {index: 1});
    const result = returnsArray[0];
    assert.deepEqual(result, resultArray.value, 'after calling getArray()');
  });

  it('getTuple(bytes, bytes, bytes) returns (bytes, bytes, bytes)', function* () {
    const methodName = 'getTuple';
    const args = {v1: util.toBytes32('test4'), v2: util.toBytes32('test5'), v3: util.toBytes32('test6')};
    const result = yield rest.callMethod(adminUser, contract, methodName, args);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'bytes,bytes,bytes returned from getTuple()');
  });


  it('setStruct(bytes value, bytes arrayValue, uint index) return (bytes, bytes)', function* () {
    // function setStruct(bytes value, bytes[] values) returns (bytes, bytes[])
    const methodName = 'setStruct';
    const args = {
      value: util.toBytes32('namaste'),
      arrayValue: util.toBytes32('ola'),
      count: 3
    };
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    assert.equal(returnsArray[0], args.value);
    assert.equal(returnsArray[1], args.count);

    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(util.trimNulls(state.storedStruct.value), args.value);
    assert.deepEqual(trimArrayNulls(state.storedStruct.values), ['ola','ola','ola']);
  });

  it('setStructArray(bytes, bytes, int)', function* () {
    const methodName = 'setStructArray';
    const args = {
      value: util.toBytes32('namaste'),
      arrayValue: util.toBytes32('ola'),
      count: 3
    };
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state

    const state = yield rest.getState(contract);
    state.storedStructs.map(function(storedStruct, i) {
      assert.equal(uitl.trimNulls(storedStruct.value), args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(trimArrayNulls(storedStruct.values), ['ola','ola','ola']);
    })
  });

  it('setMapping(bytes value, bytes key)', function* () {
    // function setMapping(bytes value, bytes key) returns (bytes value)
    const methodName = 'setMapping';
    const args = {value: util.toBytes32('300'), key: util.toBytes32('301')};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = returnsArray[0];
    assert.equal(util.trimNulls(result), args.value);
  });

  it('should be able to store and retrieve large bytess', function* () {
    const methodName = 'set';
    const value = util.toBytes32('0123456789ABCDEF');
    const args = { value };

    while(args.value.length <= 256) {
      const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
      const state = yield rest.getState(contract);
      assert.equal(util.trimNulls(state.storedData), args.value, 'successfully set and read bytes of length ' + args.value.length);
      args.value += value;
    }
  });
});

function trimArrayNulls(array) {
  return array.map((val) => {
    return util.trimNulls(val);
  });
}