const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const BigNumber = common.BigNumber;
const path = require('path');

describe('drop table in cirrus', function () {
  this.timeout(config.timeout);

  const adminName = util.uid('Admin');
  const adminPassword = '1234';

  const contractName = "SimpleStorage";
  const contractFilename = path.join(config.contractsPath, "cirrus/SimpleStorage.sol");
  const changedContractFilename = path.join(config.contractsPath, "cirrus/SimpleStorageChanged.sol");
  const searchableArray = [contractName]
  const constructorArgs = {_storedData: 4};
  const changedConstructorArgs = {_storedData: "a string!"};

  var adminUser;
  var contract;

  before(function* () {
    adminUser = yield rest.createUser(adminName, adminPassword);
    contract = yield rest.uploadContract(adminUser, contractName, contractFilename, constructorArgs);
  });

  it('should deploy a contract with different binary under the same name to cirrus and replace the table and abi data', function* () {
    const compileResults = yield rest.compileSearch(searchableArray, contractName, contractFilename);
    const queryResult = yield rest.waitQuery(`${contractName}?address=eq.${contract.address}`, 1);
    assert.equal(constructorArgs._storedData, queryResult[0].storedData, 'storedData should be the same value as the constructorArgs');
    const changedContract = yield rest.uploadContract(adminUser, contractName, changedContractFilename, changedConstructorArgs);
    const compileResultsC = yield rest.compileSearch(searchableArray, contractName, changedContractFilename);
    const queryResultC = yield rest.waitQuery(`${contractName}?address=eq.${changedContract.address}`, 1);
    assert.equal(changedConstructorArgs._storedData, queryResultC[0].storedData, 'storedData should be the same value as the constructorArgs');
  });
});
