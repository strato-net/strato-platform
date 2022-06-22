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
  importer
  } from 'blockapps-rest';

import BigNumber from "bignumber.js";
import * as chai from "chai";
chai.should();
chai.use(require('chai-bignumber')());

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config};

const contractName = "DataTypeBool";
const contractFilename = path.join(config.contractsPath, "DataTypeBool.sol");
const constructorArgs = {_storedData: true};

describe.skip('bool data type', function () {
  this.timeout(config.timeout);

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the bool storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (bool)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'bool returned from get()');
  });

  it('set (bool)', async() => {
    const methodName = 'set';
    const args = {value: false};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, args.value, 'bool returned from get()');
  });

  it('setArray (bool[]) / getArray() returns (bool[])', async() => {
    // set array
    const methodName = 'setArray';
    const args = {values: [false, true, false]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (bool[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {}}, options);
    const result = returnsArray[0];
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(bool, bool, bool) returns (bool, bool, bool)', async() => {
    const methodName = 'getTuple';
    const args = {v1: true, v2: true, v3: false};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = returnsArray;
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'bool,bool,bool returned from getTuple()');
  });

  it('setStruct(bool value, bool[] values) return (bool, bool[])', async() => {
    // function setStruct(bool value, bool[] values) returns (bool, bool[])
    const methodName = 'setStruct';
    const args = {value: false, values: [true, false, true]};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(returnsArray[1], args.values);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(state.storedStruct.values, args.values);
  });

  it('setStructArray(bool value, bool[] values)', async() => {
    // function setStructArray(bool value, bool[] values)
    const methodName = 'setStructArray';
    const args = {value: true, values: [false, false, true]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, 3, "Struct Array should have expected # of elements");
    state.storedStructs.map(function (storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, args.values);
    })
  });

  it('setMapping(bool value, bool key)', async() => {
    // function setMapping(bool value, bool key) returns (bool value)
    const methodName = 'setMapping';
    const args = {value: false, key: true};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = parseBool(returnsArray[0]);
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

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  const illegalValue = [ 'zzz', 'true 1'];
  const expectedStatus = 400;

  illegalValue.map(function(illegalValue) {
    it(`constructor args: '${typeof illegalValue} ${illegalValue}'`, async() => {
      // upload with bad agrs
      const args = {_storedData: illegalValue};
      try {
        await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args}, options);
      } catch(httpError) {
        // expected to throw
        assert.equal(httpError.response.status, expectedStatus, 'illegal value http status');
        return;
      }
      // error - di)d not throw
      assert(false, `constructor args: illegal value '${typeof illegalValue} ${illegalValue}' should have thrown ` + expectedStatus);
    });
  });

  illegalValue.map(function(illegalValue) {
    it(`set (enum) illegal value: '${typeof illegalValue} ${illegalValue}'`, async() => {
      const methodName = 'set';
      const args = {value: illegalValue};
      try {
        const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
      } catch(httpError) {
        // expected to throw
        assert.equal(httpError.response.status, expectedStatus, 'illegal value http status');
        return;
      }
      // error - did not throw
      assert(false, `illegal value '${typeof illegalValue} ${illegalValue}' should have thrown ` + expectedStatus);
    });
  });

  illegalValue.map(function(illegalValue) {
    it(`setArray (enum[]) / getArray() returns (enum[]): illegal value: '${typeof illegalValue} ${illegalValue}'`, async() => {
      // set array
      const methodName = 'setArray';
      const args = {values: [illegalValue, illegalValue, illegalValue]};
      try {
        const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
      } catch(httpError) {
        // expected to throw
        assert.equal(httpError.response.status, expectedStatus, 'illegal value http status');
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

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  const values = [ 0, 1, '0', '1', 111, -1, '-1'];

  values.map(function(value) {
    it(`constructor args: '${typeof value} ${value}'`, async() => {
      const args = {_storedData: value};
      contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args}, options);
      const state = await rest.getState(adminUser, contract, options);
      assert.equal(state.storedData, value, 'storedData');
    });
  });

  values.map(function(value) {
    it(`set (bool) '${typeof value} ${value}' `, async() => {
      const methodName = 'set';
      const args = {value: value};
      const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
      const state = await rest.getState(adminUser, contract, options);
      assert.equal(state.storedData, args.value, 'bool returned from get()');
    });
  });

  it('setArray (bool[]) / getArray() returns (bool[])', async() => {
    // set array
    const methodName = 'setArray';
    const args = {values: values};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (bool[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {}}, options);
    const result = returnsArray[0];
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });
});
