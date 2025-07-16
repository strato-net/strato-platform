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

describe('uint data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeUint";
  const contractFilename = path.join(config.contractsPath, "DataTypeUint.sol");
  const constructorArgs = {_storedData: 4};

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the uint storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (uint)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'uint returned from get()');
  });

  it('set (uint)', async() => {
    const methodName = 'set';
    const args = {value: 10};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, args.value, 'uint returned from get()');
  });

  it('setArray (uint[]) / getArray() returns (uint[])', async() => {
    // set array
    const methodName = 'setArray';
    const args = {values: [10,11,12]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = parseIntArray(state.storedDatum);
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (uint[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {}}, options);
    const result = parseIntArray(returnsArray[0]);
    assert.deepEqual(result, args.values, 'after calling getArray()');
  });

  it('getTuple(uint, uint, uint) returns (uint, uint, uint)', async() => {
    const methodName = 'getTuple';
    const args = {v1: 1, v2: 2, v3: 3};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = parseIntArray(returnsArray);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'uint,uint,uint returned from getTuple()');
  });

  it('setStruct(uint value, uint[] values) return (uint, uint[])', async() => {
    // function setStruct(uint value, uint[] values) returns (uint, uint[])
    const methodName = 'setStruct';
    const args = {value: 100, values: [101,102,103]};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the returned tuple
    assert.equal(returnsArray[0], args.value);
    assert.deepEqual(parseIntArray(returnsArray[1]), args.values);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStruct.value, args.value);
    assert.deepEqual(parseIntArray(state.storedStruct.values), args.values);
  });

  it('setStructArray(uint value, uint[] values)', async() => {
    // function setStructArray(uint value, uint[] values)
    const methodName = 'setStructArray';
    const args = {value: 200, values: [201,202,203]};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, 3, "Struct Array should have expected # of elements");
    state.storedStructs.map(function(storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(parseIntArray(storedStruct.values), args.values);
    })
  });

  it('setMapping(uint value, uint key)', async() => {
    // function setMapping(uint value, uint key) returns (uint value)
    const methodName = 'setMapping';
    const args = {value: 300, key: 301};
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
