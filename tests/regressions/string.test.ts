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

describe('string data type', function () {
  this.timeout(config.timeout);

  const contractName = "DataTypeString";
  const contractFilename = path.join(config.contractsPath, "DataTypeString.sol");
  const constructorArgs = {_storedData: 'test'};

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the string storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (string)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'string returned from get()');
  });

  it('set (string)', async() => {
    const methodName = 'set';
    const args = {value: 'test2'};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, args.value, 'string returned from get()');
  });


  it('setArray (string, count) / getArray(index) returns (string)', async() => {
    // set array
    const methodName = 'setArray';
    const resultArray = ['test', 'test', 'test'];
    const args = {
      value: 'test',
      count: 3
    };

    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, resultArray, 'after calling setArray (string[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {index: 1}}, options);
    const result = returnsArray[0];
    assert.deepEqual(result, resultArray[1], 'after calling getArray()');
  });

  it('getTuple(string, string, string) returns (string, string, string)', async() => {
    const methodName = 'getTuple';
    const args = {v1: 'test4', v2: 'test5', v3: 'test6'};
    const result = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'string,string,string returned from getTuple()');
  });


  it('setStruct(string value, string arrayValue, uint index) return (string, string)', async() => {
    // function setStruct(string value, string[] values) returns (string, string[])
    const methodName = 'setStruct';
    const args = {
      value: 'namaste',
      arrayValue: 'ola',
      count: 3
    };
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    assert.equal(returnsArray[0], args.value);
    assert.equal(returnsArray[1], args.count);

    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(state.storedStruct.values, ['ola','ola','ola']);
  });

  it('setStructArray(string, string, int)', async() => {
    const methodName = 'setStructArray';
    const args = {
      value: 'namaste',
      arrayValue: 'ola',
      count: 3
    };
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state

    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, args.count, "Struct Array should have expected # of elements");
    state.storedStructs.map(function(storedStruct, i) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, ['ola','ola','ola']);
    });
  });

  it('setMapping(string value, string key)', async() => {
    // function setMapping(string value, string key) returns (string value)
    const methodName = 'setMapping';
    const args = {value: '300', key: '301'};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = returnsArray[0];
    assert.equal(result, args.value);
  });

  it('should be able to store and retrieve large strings', async() => {
    const methodName = 'set';
    const value = '0123456789ABCDEF';
    const args = { value };

    while(args.value.length <= 256) {
      const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
      const state = await rest.getState(adminUser, contract, options);
      assert.equal(state.storedData, args.value, 'successfully set and read string of length ' + args.value.length);
      args.value += value;
    }
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
