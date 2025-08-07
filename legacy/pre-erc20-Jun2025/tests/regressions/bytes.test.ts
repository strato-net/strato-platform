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

describe('bytes data type', function () {
  this.timeout(config.timeout);

  const contractName = "DataTypeBytes";
  const contractFilename = path.join(config.contractsPath, "DataTypeBytes.sol");
  const constructorArgs = {_storedData: toBytes32('test')};

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the bytes storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, constructorArgs._storedData, 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (bytes)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(constructorArgs._storedData, result, 'bytes returned from get()');
  });

  it('set (bytes)', async() => {
    const methodName = 'set';
    const args = {value: toBytes32('test2')};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedData, args.value, 'bytes returned from get()');
  });

  //https://blockapps.atlassian.net/browse/STRATO-182
  it.skip('setArray (bytes, count) / getArray(index) returns (bytes)', async() => {
    // set array
    const methodName = 'setArray';
    const resultArray = [toBytes32('test'), toBytes32('test'), toBytes32('test')];
    const args = {
      value: toBytes32('test'),
      count: 3
    };

    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, resultArray, 'after calling setArray (bytes[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {index: 1}}, options);
    const result = returnsArray;
    assert.equal(result[0], resultArray[0], 'after calling getArray()');
  });

  //https://blockapps.atlassian.net/browse/STRATO-182
  it.skip('getTuple(bytes, bytes, bytes) returns (bytes, bytes, bytes)', async() => {
    const methodName = 'getTuple';
    const args = {v1: toBytes32('test4'), v2: toBytes32('test5'), v3: toBytes32('test6')};
    const result = await rest.call(adminUser, {contract, method: methodName, args}, options);
    assert.deepEqual(result, [args.v1, args.v2, args.v3], 'bytes,bytes,bytes returned from getTuple()');
  });

  it.skip('setStruct(bytes value, bytes arrayValue, uint index) return (bytes, bytes)', async() => {
    // function setStruct(bytes value, bytes[] values) returns (bytes, bytes[])
    const methodName = 'setStruct';
    const args = {
      value: toBytes32('namaste'),
      arrayValue: toBytes32('ola'),
      count: 3
    };
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    assert.equal(toBytes32(returnsArray[0]), args.value);
    assert.equal(parseInt(returnsArray[1]), args.count);

    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(toBytes32(state.storedStruct.value), args.value);
    assert.deepEqual(state.storedStruct.values, [toBytes32('ola'), toBytes32('ola'), toBytes32('ola'),]);
  });

  it.skip('setStructArray(bytes, bytes, int)', async() => {
    const methodName = 'setStructArray';
    const args = {
      value: toBytes32('namaste'),
      arrayValue: toBytes32('ola'),
      count: 3
    };
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state

    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, args.count, "Struct Array should have expected # of elements");
    state.storedStructs.forEach(function(storedStruct, i) {
      assert.equal(toBytes32(storedStruct.value), args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(storedStruct.values, [args.arrayValue, args.arrayValue, args.arrayValue]);
    });
  });

  it('setMapping(bytes value, bytes key)', async() => {
    // function setMapping(bytes value, bytes key) returns (bytes value)
    const methodName = 'setMapping';
    const args = {value: toBytes32('300'), key: toBytes32('301')};
    const returnsArray = await rest.call(adminUser, {contract, method: methodName, args}, options);
    const result = returnsArray[0];
    assert.equal(result, args.value);
  });

  it('call method with value', async() => {
    const methodName = 'get';
    const methodArgs = {};
    const setMethodName = 'set';
    const setMethodArgs = {value: constructorArgs._storedData};
    const etherToSend = 0;

    //Call method with value
    await rest.call(adminUser, {contract, method: setMethodName, args: setMethodArgs}, options);
    const resultWithValue = await rest.call(adminUser, {contract, method: methodName, args: methodArgs, value: new BigNumber(etherToSend)}, options);
    assert.equal(resultWithValue[0], constructorArgs._storedData, "method call with value should execute");

    const accounts = await rest.getAccounts(adminUser, {...options, params: {address: contract.address}})
    const contractBalance = accounts[0].balance;
    const expectedBalance = (new BigNumber(etherToSend)).multipliedBy(constants.ETHER);
    assert.isOk(expectedBalance.isEqualTo(contractBalance), "contract balance should equal value from method call");
  });
});


function toBytes32(x) {
  if (x === undefined) return undefined;
  return (hexEncode8(x)+"0".repeat(64)).slice(0,64);
}

function hexEncode8(text) {
  var hex, i;
  var result = "";
  for (i = 0; i < text.length; i++) {
    hex = text.charCodeAt(i).toString(16);
    result += ("0" + hex).slice(-2);
  }
  return result
}
