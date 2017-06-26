const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');

describe('address data type', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "DataTypeAddress";
  const contractFilename = path.join(config.contractsPath, "dataTypes/DataTypeAddress.sol");
  const constructorArgs = {_storedData: '1'};

  var adminUser;
  var contract;

  before(function*() {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should upload the address storage contract with constructor arguments', function*() {
    const state = yield rest.getState(contract);
    assert.equal(addressToString(state.storedData), addressToString(constructorArgs._storedData), 'storedData');
    assert.equal(state.storedDatum.length, 0, 'storedDatum');
  });

  it('get() returns (address)', function*() {
    const methodName = 'get';
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName);
    const result = returnsArray[0];
    assert.equal(addressToString(constructorArgs._storedData), addressToString(result), 'address returned from get()');
  });

  it('set (address)', function*() {
    const methodName = 'set';
    const args = {value: '0'};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    assert.equal(addressToString(state.storedData), addressToString(args.value), 'address returned from get()');
  });

  it('setArray (address[]) / getArray() returns (address[])', function*() {
    // set array
    const methodName = 'setArray';
    const args = {values: ['0000000000000000000000000000000000000010','0000000000000000000000000000000000000001', '0000000000000000000000000000000001000000']};
    yield rest.callMethod(adminUser, contract, methodName, args);
    const state = yield rest.getState(contract);
    const storedDatum = state.storedDatum;
    assert.deepEqual(storedDatum, args.values, 'after calling setArray (address[])');
    // get array
    const returnsArray = yield rest.callMethod(adminUser, contract, 'getArray');
    const result = returnsArray[0];
    assert.deepEqual(addressToString(result), addressToString(args.values), 'after calling getArray()');
  });

  it('getTuple(address, address, address) returns (address, address, address)', function*() {
    const methodName = 'getTuple';
    const args = {v1: '0ea674fdde714fd979de3edf0f56aa9716b898ec8', v2: '0e71647d2b46e1a063509c64e2cd084e4f2493d11', v3: '0cc11be9f73a4505c384baa0d6851bbbb249fe3b3'};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = returnsArray;
    assert.deepEqual(addressToString(result), addressToString([args.v1, args.v2, args.v3]), 'address,address,address returned from getTuple()');
  });

  it('setStruct(address value, address[] values) return (address, address[])', function*() {
    // function setStruct(address value, address[] values) returns (address, address[])
    const methodName = 'setStruct';
    const args = {value: '0ea674fdde714fd979de3edf0f56aa9716b898ec8', values: ['08d12a197cb00d4747a1fe03395095ce2a5cc6819', '08d12a197cb00d4747a1fe03395095ce2a5cc6819', '01ce98ed5dc2592b71dd3f2b753b3a44869d7389e']};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    // check the returned tuple
    assert.equal(addressToString(returnsArray[0]), addressToString(args.value));
    assert.deepEqual(addressToString(returnsArray[1]), addressToString(args.values));
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(addressToString(state.storedStruct.value), addressToString(args.value));
    assert.deepEqual(addressToString(state.storedStruct.values), addressToString(args.values));
  });

  it.skip('setStructArray(address value, address[] values)', function*() {
    // function setStructArray(address value, address[] values)
    const methodName = 'setStructArray';
    const args = {value: '0e80a58e5c445c4ecdc5998e2803d216786c9a771', values: ['08d12a197cb00d4747a1fe03395095ce2a5cc6819', '0a10af358d01eca18a446ba768585d23ff055a89e', '01e9939daaad6924ad004c2560e90804164900341']};
    yield rest.callMethod(adminUser, contract, methodName, args);
    // check the struct state
    const state = yield rest.getState(contract);
    assert.equal(state.storedStructs.length, args.count, "Struct Array should have expected # of elements");
    state.storedStructs.map(function (storedStruct) {
      assert.equal(storedStruct.value, args.value, 'Struct Array - See issue API-8 (https://blockapps.atlassian.net/browse/API-8)');
      assert.deepEqual(addressToString(storedStruct.values), addressToString(args.values));
    })
  });

  it('setMapping(address value, address key)', function* () {
    // function setMapping(address value, address key) returns (address value)
    const methodName = 'setMapping';
    const args = {value: '0e80a58e5c445c4ecdc5998e2803d216786c9a771', key: '0a10af358d01eca18a446ba768585d23ff055a89e'};
    const returnsArray = yield rest.callMethod(adminUser, contract, methodName, args);
    const result = returnsArray[0];
    assert.equal(addressToString(result), addressToString(args.value));
  });
});

function addressToString(addr) {
  if (Array.isArray(addr)) {
    return addr.map(function(member) {
      return util.trimLeadingZeros(member.toLowerCase());
    });
  }
  return util.trimLeadingZeros(addr.toLowerCase());
}
