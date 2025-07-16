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

describe('int data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeInt";
  const contractFilename = path.join(config.contractsPath, "DataTypeInt.sol");
  const constructorArgs = {_storedData: -4};

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the int storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (int)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'int returned from get()');
  });

  it('set (int) negative number', async() => {
    const methodName = 'set';
    const args = {value: -9999990000};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, args.value, 'int returned from get()');
  });

  it('setArray (int[]) / getArray() returns (int[])', async() => {
    // set array
    const methodName = 'setArray';
    const args = {values: [-12345678, -12345679, -12345680]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = parseIntArray(state.storedDatum);
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (int[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {}}, options);
    const result = parseIntArray(returnsArray[0]);
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(int, int, int) returns (int, int, int)', async() => {
    const methodName = 'getTuple';
    const args = {v1: -1, v2: -2, v3: -3};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = parseIntArray(returnsArray);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'int,int,int returned from getTuple()');
  });

  it('setStruct(int value, int[] values) return (int, int[])', async() => {
    // function setStruct(int value, int[] values) returns (int, int[])
    const methodName = 'setStruct';
    const args = {value: -100, values: [-101,-102,-103]};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(parseIntArray(returnsArray[1]), args.values);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(parseIntArray(state.storedStruct.values), args.values);
  });

  it('setStructArray(int value, int[] values)', async() => {
    // function setStructArray(int value, int[] values)
    const methodName = 'setStructArray';
    const args = {value: -200, values: [-201,-202,-203]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, 3, "Struct Array should have expected # of elements");
    state.storedStructs.map(function(storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(parseIntArray(storedStruct.values), args.values);
    })
  });

  it('setMapping(int value, int key)', async() => {
    // function setMapping(int value, int key) returns (int value)
    const methodName = 'setMapping';
    const args = {value: -300, key: -301};
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

function parseIntArray(arrayOfStrings) {
  return arrayOfStrings.map(function(member) {
    return parseInt(member);
  });
}
