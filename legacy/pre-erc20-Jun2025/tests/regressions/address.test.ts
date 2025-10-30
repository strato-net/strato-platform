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

describe('address data type', function () {
  this.timeout(config.timeout);

  const contractName = "DataTypeAddress";
  const contractFilename = path.join(config.contractsPath, "DataTypeAddress.sol");
  const constructorArgs = {_storedData: '1'};

  var adminUser;
  var contract;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    adminUser = await rest.createUser(ouser, options);
    contract = await rest.createContract(adminUser, {name: contractName, source: await importer.combine(contractFilename), args: constructorArgs}, options);
  });

  it('should upload the address storage contract with constructor arguments', async() => {
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(addressToString(state.storedData), addressToString(constructorArgs._storedData), 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (address)', async() => {
    const methodName = 'get';
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args: {}}, options);
    const result = returnsArray[0];
    assert.equal(addressToString(constructorArgs._storedData), addressToString(result), 'address returned from get()');
  });

  it('set (address)', async() => {
    const methodName = 'set';
    const args = {value: '0'};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(addressToString(state.storedData), addressToString(args.value), 'address returned from get()');
  });

  it('setArray (address[]) / getArray() returns (address[])', async() => {
    // set array
    const methodName = 'setArray';
    const args = {values: ['0000000000000000000000000000000000000010','0000000000000000000000000000000000000001', '0000000000000000000000000000000001000000']};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const state = await rest.getState(adminUser, contract, options);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (address[])');
    // get array
    const returnsArray = await rest.call(adminUser, {contract: contract, method: 'getArray', args: {}}, options);
    const result = returnsArray[0];
    assert.deepEqual(addressToString(result), addressToString(args.values), 'after calling getArray()');
  });

  it('getTuple(address, address, address) returns (address, address, address)', async() => {
    const methodName = 'getTuple';
    const args = {v1: 'ea674fdde714fd979de3edf0f56aa9716b898ec8', v2: 'e71647d2b46e1a063509c64e2cd084e4f2493d11', v3: 'cc11be9f73a4505c384baa0d6851bbbb249fe3b3'};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = returnsArray;
    assert.deepEqual(addressToString(result), addressToString([args.v1, args.v2, args.v3]), 'address,address,address returned from getTuple()');
  });

  it('setStruct(address value, address[] values) return (address, address[])', async() => {
    // function setStruct(address value, address[] values) returns (address, address[])
    const methodName = 'setStruct';
    const args = {value: 'ea674fdde714fd979de3edf0f56aa9716b898ec8', values: ['8d12a197cb00d4747a1fe03395095ce2a5cc6819', '8d12a197cb00d4747a1fe03395095ce2a5cc6819', '1ce98ed5dc2592b71dd3f2b753b3a44869d7389e']};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the returned tuple
    assert.equal(addressToString(returnsArray[0]), addressToString(args.value));
    assert.deepEqual(addressToString(returnsArray[1]), addressToString(args.values));
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(addressToString(state.storedStruct.value), addressToString(args.value));
    assert.deepEqual(addressToString(state.storedStruct.values), addressToString(args.values));
  });

  it('setStructArray(address value, address[] values)', async() => {
    // function setStructArray(address value, address[] values)
    const methodName = 'setStructArray';
    const args = {value: 'e80a58e5c445c4ecdc5998e2803d216786c9a771', values: ['8d12a197cb00d4747a1fe03395095ce2a5cc6819', 'a10af358d01eca18a446ba768585d23ff055a89e', '1e9939daaad6924ad004c2560e90804164900341']};
    await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    // check the struct state
    const state = await rest.getState(adminUser, contract, options);
    assert.equal(state.storedStructs.length, 3, "Struct Array should have expected # of elements");
    state.storedStructs.map(function (storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(addressToString(storedStruct.values), addressToString(args.values));
    })
  });

  it('setMapping(address value, address key)', async() => {
    // function setMapping(address value, address key) returns (address value)
    const methodName = 'setMapping';
    const args = {value: 'e80a58e5c445c4ecdc5998e2803d216786c9a771', key: 'a10af358d01eca18a446ba768585d23ff055a89e'};
    const returnsArray = await rest.call(adminUser, {contract: contract, method: methodName, args}, options);
    const result = returnsArray[0];
    assert.equal(addressToString(result), addressToString(args.value));
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
    assert.equal(addressToString(resultWithValue[0]), constructorArgs._storedData, "method call with value should execute");

    const accounts = await rest.getAccounts(adminUser, {...options, params: {address: contract.address}})
    const contractBalance = accounts[0].balance;
    const expectedBalance = (new BigNumber(etherToSend)).multipliedBy(constants.ETHER);
    assert.isOk(expectedBalance.isEqualTo(contractBalance), "contract balance should equal value from method call");
  });
});

function addressToString(addr) {
  if (Array.isArray(addr)) {
    return addr.map(function(member) {
      return trimLeadingZeros(member.toLowerCase());
    });
  }
  return trimLeadingZeros(addr.toLowerCase());
}

function trimLeadingZeros(obj) {
  // if array - iterate
  if (Array.isArray(obj)) {
    return obj.map(function(member) {
      return trimLeadingZeros(member);
    });
  }
  // string - trim
  var target = obj;
  while (target.slice(0,1) == '0') {
    // if only one 0 left - return it
    if (target.length == 1) {
      return target;
    }
    // trim one 0
    target = target.slice(1);
  }
  return target;
}
