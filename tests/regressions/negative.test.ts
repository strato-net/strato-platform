const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const BigNumber = common.BigNumber;
const path = require('path');

describe('int data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeInt";
  const contractFilename = path.join(config.contractsPath, "DataTypeInt.sol");
  const constructorArgs = {_storedData: -4};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the int storage contract with constructor arguments', function* () {
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (int)', function* () {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'int returned from get()');
  });

  it('set (int) negative number', function* () {
    const methodName = 'set';
    const args = {value: -9999990000};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, args.value, 'int returned from get()');
  });

  it('setArray (int[]) / getArray() returns (int[])', function* () {
    // set array
    const methodName = 'setArray';
    const args = {values: [-12345678, -12345679, -12345680]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = parseIntArray(state.storedDatum);
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (int[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray');
    const result = parseIntArray(returnsArray[0]);
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(int, int, int) returns (int, int, int)', function* () {
    const methodName = 'getTuple';
    const args = {v1: -1, v2: -2, v3: -3};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = parseIntArray(returnsArray);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'int,int,int returned from getTuple()');
  });

  it('setStruct(int value, int[] values) return (int, int[])', function* () {
    // function setStruct(int value, int[] values) returns (int, int[])
    const methodName = 'setStruct';
    const args = {value: -100, values: [-101,-102,-103]};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(parseIntArray(returnsArray[1]), args.values);
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(parseIntArray(state.storedStruct.values), args.values);
  });

  it('setStructArray(int value, int[] values)', function* () {
    // function setStructArray(int value, int[] values)
    const methodName = 'setStructArray';
    const args = {value: -200, values: [-201,-202,-203]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStructs.length, 3, "Struct Array should have expected # of elements");
    state.storedStructs.map(function(storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(parseIntArray(storedStruct.values), args.values);
    })
  });

  it('setMapping(int value, int key)', function* () {
    // function setMapping(int value, int key) returns (int value)
    const methodName = 'setMapping';
    const args = {value: -300, key: -301};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = parseInt(returnsArray[0]);
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

function parseIntArray(arrayOfStrings) {
  return arrayOfStrings.map(function(member) {
    return parseInt(member);
  });
}
