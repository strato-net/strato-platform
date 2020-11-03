const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const BigNumber = common.BigNumber;
const path = require('path');

describe('bytes data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeBytes";
  const contractFilename = path.join(config.contractsPath, "DataTypeBytes.sol");
  const constructorArgs = {_storedData: util.toBytes32('test')};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the bytes storage contract with constructor arguments', function* () {
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (bytes)', function* () {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, util.toBytes32(result), 'bytes returned from get()');
  });

  it('set (bytes)', function* () {
    const methodName = 'set';
    const args = {value: util.toBytes32('test2')};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, args.value, 'bytes returned from get()');
  });

  //https://blockapps.atlassian.net/browse/STRATO-182
  it.skip('setArray (bytes, count) / getArray(index) returns (bytes)', function* () {
    // set array
    const methodName = 'setArray';
    const resultArray = [util.toBytes32('test'), util.toBytes32('test'), util.toBytes32('test')];
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
    const result = returnsArray;
    assert.equal(result[0], resultArray[0], 'after calling getArray()');
  });

  //https://blockapps.atlassian.net/browse/STRATO-182
  it.skip('getTuple(bytes, bytes, bytes) returns (bytes, bytes, bytes)', function* () {
    const methodName = 'getTuple';
    const args = {v1: util.toBytes32('test4'), v2: util.toBytes32('test5'), v3: util.toBytes32('test6')};
    const result = yield rest.callMethod(adminUser, contract, methodName, args);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'bytes,bytes,bytes returned from getTuple()');
  });

  it.skip('setStruct(bytes value, bytes arrayValue, uint index) return (bytes, bytes)', function* () {
    // function setStruct(bytes value, bytes[] values) returns (bytes, bytes[])
    const methodName = 'setStruct';
    const args = {
      value: util.toBytes32('namaste'),
      arrayValue: util.toBytes32('ola'),
      count: 3
    };
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    assert.equal(util.toBytes32(returnsArray[0]), args.value);
    assert.equal(parseInt(returnsArray[1]), args.count);

    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(util.toBytes32(state.storedStruct.value), args.value);
    assert.deepEqual(state.storedStruct.values, [util.toBytes32('ola'), util.toBytes32('ola'), util.toBytes32('ola'),]);
  });

  it.skip('setStructArray(bytes, bytes, int)', function* () {
    const methodName = 'setStructArray';
    const args = {
      value: util.toBytes32('namaste'),
      arrayValue: util.toBytes32('ola'),
      count: 3
    };
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state

    const state = yield rest.getState(contract);
    assert.equal(state.storedStructs.length, args.count, "Struct Array should have expected # of elements");
    state.storedStructs.forEach(function(storedStruct, i) {
      assert.equal(util.toBytes32(storedStruct.value), args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, [args.arrayValue, args.arrayValue, args.arrayValue]);
    });
  });

  it('setMapping(bytes value, bytes key)', function* () {
    // function setMapping(bytes value, bytes key) returns (bytes value)
    const methodName = 'setMapping';
    const args = {value: util.toBytes32('300'), key: util.toBytes32('301')};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = returnsArray[0];
    assert.equal(util.toBytes32(result), args.value);
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
    assert.equal(util.toBytes32(resultWithValue[0]), constructorArgs._storedData, "method call with value should execute");

    const contractBalance = yield rest.getBalance(contract.address);
    const expectedBalance = (new BigNumber(etherToSend)).mul(common.constants.ETHER);
    assert.isOk(expectedBalance.equals(contractBalance), "contract balance should equal value from method call");
  });
});
