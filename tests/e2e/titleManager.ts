const ba = require('blockapps-rest');
const rest = ba.rest;
const util = ba.common.util;
const config = ba.common.config;
const path = require('path');
const titleJs = require('./title')

const ErrorCodes = rest.getEnums(path.join(config.contractsPath, "ErrorCodes.sol")).ErrorCodes;
const contractName = 'TitleManager';
const contractFilename = path.join(config.contractsPath, 'TitleManager.sol');

function* uploadContract(admin) {
  // NOTE: in production, the contract is created and owned by the AdminInterface
  // for testing purposes the creator is the admin user
  const args = {_creator: admin.address};
  const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
  yield compileSearch();
  contract.src = 'removed';
  return bind(admin, contract);
}

function bind(admin, contract) {
  contract.getState = function*() {
    return yield rest.getState(contract);
  }
  contract.createTitleAsync = function*(args) {
    return yield createTitleAsync(admin, contract, args);
  }
  contract.createTitle = function*(args) {
    return yield createTitle(admin, contract, args);
  }
  contract.exists = function*(vin) {
    return yield exists(admin, contract, vin);
  }
  return contract;
}

function* compileSearch() {
  rest.verbose('compileSearch', contractName);

  if (yield rest.isCompiled(contractName)) {
    return;
  }

  // compile dependencies
  yield titleJs.compileSearch();
  {
    const contractName = 'TitleMo';
    const contractFilename = `${config.libPath}/contracts/TitleMo.sol`;
    const searchable = [contractName];
    yield rest.compileSearch(searchable, contractName, contractFilename);
  }

  const searchable = [contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

// throws: ErrorCodes
// returns: new title address
function* createTitleAsync(admin, contract, args) {
  rest.verbose('createTitle', args);
  // function createTitle(string _vin) returns (ErrorCodes, address) {
  const method = 'createTitle';

  const result = yield rest.callMethod(admin, contract, method, args);
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error(errorCode);
  }
  // TODO test if valid address
  return result[1];
}

// blocks until title appears in search
// throws: ErrorCodes
// returns: new title as returned form search
function* createTitle(admin, contract, args) {
  rest.verbose('createTitle', args);
  // function createTitle(string _vin) returns (ErrorCodes, address) {
  const address = yield createTitleAsync(admin, contract, args);
  const title = yield titleJs.waitForAddress(address);
  return title;
}

function* exists(admin, contract, vin) {
  rest.verbose('exists', vin);
  // function exists(string vin) returns (bool) {
  const method = 'exists';
  const args = {
    vin: vin,
  };
  const result = yield rest.callMethod(admin, contract, method, args);
  const exists = (result[0] === true);
  return exists;
}

function* getByVin(vin) {
  console.log('titleManagerJs', 'getByVin', vin);
  return yield titleJs.getByVin(vin);
}

module.exports = {
  bind: bind,
  compileSearch: compileSearch,
  getByVin: getByVin,
  uploadContract: uploadContract,
};
