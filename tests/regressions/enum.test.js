const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const BigNumber = common.BigNumber;
const path = require('path');

const adminName = util.uid('Admin');
const adminPassword = '1234';
const ErrorCodes = rest.getEnums(path.join(config.contractsPath, '/DataTypeErrorCodes.sol')).ErrorCodes;

const contractName = "DataTypeEnum";
const contractFilename = path.join(config.contractsPath, "DataTypeEnum.sol");
const constructorArgs = {_storedData: ErrorCodes.ERROR};

describe('enum data type: positive case:', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the storage contract with constructor arguments', function* () {
    const state = yield rest.getState(contract);
    state.storedData = state.storedData;
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
    state.storedData = state.storedData;
    assert.equal(state.storedData, args.value, 'enum returned from get()');
  });

  it('set (enum) string', function* () {
    const methodName = 'set';
    const args = {value: ErrorCodes.EXISTS};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(state.storedData, args.value, 'enum returned from get()');
  });

  it('setArray (enum[]) / getArray() returns (enum[])', function* () {
    // set array
    const methodName = 'setArray';
    const args = {values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.EXISTS]};
    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = parseIntArray(state.storedDatum);
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
    const value = state.storedStruct.value;
    const values = parseIntArray(state.storedStruct.values);
    assert.equal(value, args.value);
    assert.deepEqual(values, args.values);
  });

  it('setStructArray(enum value, enum[] values)', function* () {
    // function setStructArray(enum value, enum[] values)
    const methodName = 'setStructArray';
    const args = {
      value: ErrorCodes.INSUFFICIENT_BALANCE,
      values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.NOT_FOUND],
      count: 3 };
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStructs.length, args.count, 'count');
    state.storedStructs.map(function(storedStruct) {
      const value = storedStruct.value;
      assert.equal(value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      const values = parseIntArray(storedStruct.values);
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

describe.skip('enum data type: illegal values:', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  const illegalValue = [ -1, '-1', 12, '12', 'zzz'];
  const expectedStatus = 400;

  illegalValue.map(function(illegalValue) {
    it.skip(`constructor args: '${typeof illegalValue} ${illegalValue}'`, function* () {
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
    it.skip(`set (enum) illegal value: '${typeof illegalValue} ${illegalValue}'`, function* () {
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
    it.skip(`setArray (enum[]) / getArray() returns (enum[]): illegal value: '${typeof illegalValue} ${illegalValue}'`, function* () {
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


function parseIntArray(arrayOfStrings) {
  return arrayOfStrings.map(function(member) {
    return parseInt(member);
  });
}
