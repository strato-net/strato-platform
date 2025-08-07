import * as path from 'path';

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Contract,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  importer,
  parser
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config};

const ErrorCodes = parser.parseEnum(fsUtil.get(path.join(config.contractsPath, '/DataTypeErrorCodes.sol')));

const contractName = "DataTypeEnum";
const contractFilename = path.join(config.contractsPath, "DataTypeEnum.sol");
const constructorArgs = {_storedData: ErrorCodes.ERROR};

describe('enum data type: positive case:', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    state.storedData = state.storedData;
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (enum)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'enum returned from get()');
  });

  it('set (enum)', async() => {
    const methodName = 'set';
    const args = {value: ErrorCodes.EXISTS};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    state.storedData = state.storedData;
    assert.equal(state.storedData, args.value, 'enum returned from get()');
  });

  it('set (enum) string', async() => {
    const methodName = 'set';
    const args = {value: ErrorCodes.EXISTS};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, args.value, 'enum returned from get()');
  });

  it('setArray (enum[]) / getArray() returns (enum[])', async() => {
    // set array
    const methodName = 'setArray';
    const args = {values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.EXISTS]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = parseIntArray(state.storedDatum);
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (enum[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {}}, options);
    const result = parseIntArray(returnsArray[0]);
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(enum, enum, enum) returns (enum, enum, enum)', async() => {
    const methodName = 'getTuple';
    const args = {v1: ErrorCodes.SUCCESS, v2: ErrorCodes.ERROR, v3: ErrorCodes.NOT_FOUND};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = parseIntArray(returnsArray);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'enum,enum,enum returned from getTuple()');
  });

  it('setStruct(enum value, enum[] values) return (enum, enum[])', async() => {
    // function setStruct(enum value, enum[] values) returns (enum, enum[])
    const methodName = 'setStruct';
    const args = {value: ErrorCodes.INSUFFICIENT_BALANCE, values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.NOT_FOUND]};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(parseIntArray(returnsArray[1]), args.values);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    const value = state.storedStruct.value;
    const values = parseIntArray(state.storedStruct.values);
    assert.equal(value, args.value);
    assert.deepEqual(values, args.values);
  });

  it('setStructArray(enum value, enum[] values)', async() => {
    // function setStructArray(enum value, enum[] values)
    const methodName = 'setStructArray';
    const args = {
      value: ErrorCodes.INSUFFICIENT_BALANCE,
      values: [ErrorCodes.SUCCESS, ErrorCodes.ERROR, ErrorCodes.NOT_FOUND],
      count: 3 };
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, args.count, 'count');
    state.storedStructs.map(function(storedStruct) {
      const value = storedStruct.value;
      assert.equal(value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      const values = parseIntArray(storedStruct.values);
      assert.deepEqual(values, args.values, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
    })
  });

  it('setMapping(enum value, enum key)', async() => {
    // function setMapping(enum value, enum key) returns (enum value)
    const methodName = 'setMapping';
    const args = {value: ErrorCodes.EXISTS, key: 666};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = parseInt(returnsArray[0]);
    assert.equal(result, args.value);
  });

  it('call method with value', async() => {
    const methodName = 'get';
    const methodArgs = {};
    const setMethodName = 'set';
    const setMethodArgs = {value: constructorArgs._storedData};
    const etherToSend = 0;

    //Call method with value
    await rest.call(adminUser, {contract: contract, method: setMethodName, args: setMethodArgs}, options);
    const resultWithValue = await rest.call(adminUser, {contract: contract, method: methodName, args: methodArgs, value: new BigNumber(etherToSend)}, options);
    assert.equal(resultWithValue[0], constructorArgs._storedData, "method call with value should execute");

    const accounts = await rest.getAccounts(adminUser, {...options, params: {address: contract.address}})
    const contractBalance = accounts[0].balance;
    const expectedBalance = (new BigNumber(etherToSend)).multipliedBy(constants.ETHER);
    assert.isOk(expectedBalance.isEqualTo(contractBalance), "contract balance should equal value from method call");
  });
});

describe.skip('enum data type: illegal values:', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  const illegalValue = [ -1, '-1', 12, '12', 'zzz'];
  const expectedStatus = 400;

  illegalValue.map(function(illegalValue) {
    it.skip(`constructor args: '${typeof illegalValue} ${illegalValue}'`, async() => {
      // upload with bad agrs
      const args = {_storedData: illegalValue};
      try {
        await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: args}, options);
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
    it.skip(`set (enum) illegal value: '${typeof illegalValue} ${illegalValue}'`, async() => {
      const methodName = 'set';
      const args = {value: illegalValue};
      try {
        const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
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
    it.skip(`setArray (enum[]) / getArray() returns (enum[]): illegal value: '${typeof illegalValue} ${illegalValue}'`, async() => {
      // set array
      const methodName = 'setArray';
      const args = {values: [illegalValue, illegalValue, illegalValue]};
      try {
        const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
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
