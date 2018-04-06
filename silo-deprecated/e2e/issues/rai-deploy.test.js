const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;
const Tx = common.model.Tx;
const BigNumber = common.BigNumber;
const importer = require('../lib/importer');
const conversion = require('../lib/conversion')
// ---------------------------------------------------
//   test suites
// ---------------------------------------------------
describe('rai-deploy - admin', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test
  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);
  const contract = new Contract('AdminInterface', './fixtures/rai/contracts/AdminInterface.sol');
  itShould.importAndUploadBlob(alice, contract);
  itShould.getAbi(contract);
  it('should have a valid contract state', function(done) {
    assert.equal(contract.state.name, contract.name, 'should have the right name');
    done();
  });
  itShould.getState(contract);
  const testCall = new Call('init', {}, 'null');
  itShould.callMethod(alice, contract, testCall);
  it('should return ' + testCall.expected, function(done) {
    assert.equal(testCall.result, testCall.expected, 'should return the expected value');
    done();
  });
  itShould.getState(contract);
  const permissionContract = new Contract('PermissionManager', {}, {}, {});
  it('should return permissionManager address' , function(done) {
    permissionContract.address = contract.state.permissionManager;
    assert.notEqual(permissionContract.address, 0);
    assert.ok(util.isAddress(permissionContract.address));
    console.log(permissionContract.address);
     //assert.equal(contract.state.permissionManager, 0, 'should return the expected value'); <<< BigNumber
    done();
  });
  // function hasPermission(RoleEnum re, PermissionEnum pe) constant returns (bool) 
  const testPermissionCall = new Call('hasPermission', {re: 1, pe: 3}, 'false');
  itShould.callMethod(alice, permissionContract, testPermissionCall);
  it('should return ' + testPermissionCall.expected, function(done) {
    assert.equal(testPermissionCall.result, testPermissionCall.expected, 'should return the expected value');
    done();
  });
  itShould.getState(permissionContract);
  const userManager = new Contract('UserManager', {}, {}, {});
  it('should return userManager address', function(done){
    userManager.address = contract.state.userManager;
    console.log(userManager.address);
    done();
  });

  // function add(bytes32 username, RoleEnum r, address addr, bytes32 p) returns (uint userId)
  const testUserManagerCall = new Call('add', {
      username: conversion.toSolidity('bob'),
      r: 1, 
      addr: "1234abcd", 
      p: conversion.toSolidity('some data to store')
    }, '1');
  itShould.callMethod(alice, userManager, testUserManagerCall);
  it('should return ' + testUserManagerCall.expected, function(done){
    assert.equal(testUserManagerCall.result, testUserManagerCall.expected, 'should return the expected value');
    done();
  });
  itShould.getState(userManager);

  it('should set mapping and key', function(done){
    userManager.mapping = 'dataMap';
    userManager.key = 'hello';
    done();
  });

  itShould.getStateMapping(userManager)
  it('should have value ' + "0", function(done){
    assert.equal(userManager.state.dataMap.hello, "0", 'should return the expected value for mapping');
    done();
  });

  it('should set mapping and key', function(done){
    userManager.mapping = 'dataMap';
    userManager.key = 'bob';
    done();
  });

  itShould.getStateMapping(userManager)
  it('should have value ' + "1", function(done){
    assert.equal(userManager.state.dataMap.bob, "1", 'should return the expected value for mapping');
    done();
  });

  it('should set mapping and key', function(done){
    userManager.mapping = 'dataMap_somethingthatdoesnotexist';
    userManager.key = 'bob';
    done();
  });

  itShould.getStateMapping(userManager)
  it('should have value return nothing', function(done){
    assert.equal(userManager.state, "invalid map dataMap_somethingthatdoesnotexist", 'should return error');
    done();
  });

});






