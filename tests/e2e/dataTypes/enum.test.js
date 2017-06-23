const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('enum data type: positive case:', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';
  const ErrorCodes = rest.getEnums(path.join(config.contractsPath, '/dataTypes/ErrorCodes.sol')).ErrorCodes;

  const contractName = "DataTypeEnum";
  const contractFilename = path.join(config.contractsPath, "/dataTypes/DataTypeEnum.sol");
  const constructorArgs = {_storedData: ErrorCodes.ERROR};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the storage contract with constructor arguments', function* () {
    const state = yield rest.getState(contract);
    state.storedData = ErrorCodes[util.parseEnum(state.storedData)]; //
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (enum)', function* () {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'enum returned from get()');
  });

  it('set (enum)', function* () {
    const methodName = 'set';
    const args = {value: ErrorCodes.EXISTS};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    state.storedData = ErrorCodes[util.parseEnum(state.storedData)];
    assert.equal(state.storedData, args.value, 'enum returned from get()');
  });

  it('setArray (enum[]) / getArray() returns (enum[])', function* () {
    // set array
    const methodName = 'setArray';
    const args = {values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.EXISTS]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum.map(function(member) {
      return ErrorCodes[util.parseEnum(member)];
    });
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (enum[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray');
    const result = parseIntArray(returnsArray[0]);
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(enum, enum, enum) returns (enum, enum, enum)', function* () {
    const methodName = 'getTuple';
    const args = {v1: ErrorCodes.SUCCESS, v2: ErrorCodes.ERROR, v3: ErrorCodes.NOT_FOUND};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = parseIntArray(returnsArray);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'enum,enum,enum returned from getTuple()');
  });

  it('setStruct(enum value, enum[] values) return (enum, enum[])', function* () {
    // function setStruct(enum value, enum[] values) returns (enum, enum[])
    const methodName = 'setStruct';
    const args = {value: ErrorCodes.INSUFFICIENT_BALANCE, values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.NOT_FOUND]};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(parseIntArray(returnsArray[1]), args.values);
    // check the struct state
    const state = yield rest.getState(contract);
    const value = ErrorCodes[util.parseEnum(state.storedStruct.value)];
    const values = state.storedStruct.values.map(function(member) {
      return ErrorCodes[util.parseEnum(member)];
    });
    assert.equal(value, args.value);
    assert.deepEqual(values, args.values);
  });

  it('setStructArray(enum value, enum[] values)', function* () {
    // function setStructArray(enum value, enum[] values)
    const methodName = 'setStructArray';
    const args = {value: ErrorCodes.INSUFFICIENT_BALANCE, values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.NOT_FOUND]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state
    const state = yield rest.getState(contract);
    state.storedStructs.map(function(storedStruct) {
      const value = ErrorCodes[util.parseEnum(storedStruct.value)];
      assert.equal(value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      const values = storedStruct.values.map(function(member) {
        return ErrorCodes[util.parseEnum(member)];
      });
      assert.deepEqual(values, args.values, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
    })
  });

  it('setMapping(enum value, enum key)', function* () {
    // function setMapping(enum value, enum key) returns (enum value)
    const methodName = 'setMapping';
    const args = {value: ErrorCodes.EXISTS, key: 666};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = parseInt(returnsArray[0]);
    assert.equal(result, args.value);
  });
});

describe.only('enum data type: positive case:', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';
  const ErrorCodes = rest.getEnums(path.join(config.contractsPath, '/dataTypes/ErrorCodes.sol')).ErrorCodes;

  const contractName = "DataTypeEnum";
  const contractFilename = path.join(config.contractsPath, "/dataTypes/DataTypeEnum.sol");
  const constructorArgs = {_storedData: ErrorCodes.ERROR};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('set (enum) illegal values: -1', function* () {
    const expectedStatus = 400;
    const methodName = 'set';
    const args = {value: 999};
    try {
      const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    } catch(e) {
      assert.equal(e.status, expectedStatus, 'illegal value http status');
      return;
    }
    assert(false, 'illegal value should have thrown ' + expectedStatus);
  });
});


function parseIntArray(arrayOfStrings) {
  return arrayOfStrings.map(function(member) {
    return parseInt(member);
  });
}
