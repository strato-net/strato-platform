const ba = require('blockapps-rest');
const rest = ba.rest;
const util = ba.common.util;
const config = ba.common.config;
const path = require('path');
const titleJs = require('./title')

const ErrorCodes = rest.getEnums(path.join(config.contractsPath, "ErrorCodes.sol")).ErrorCodes;
const contractName = 'TitleManager';
const contractFilename = path.join(config.contractsPath, "TitleManager.sol");

function* uploadContract(admin) {
  // NOTE: in production, the contract is created and owned by the AdminInterface
  // for testing purposes the creator is the admin user
  const args = { creator: admin.address };
  const contract = yield rest.uploadContract(admin, contractName, contractFilename, util.usc(args));
  yield compileSearch(contract);
  contract.src = 'removed';
  return bind(admin, contract);
}

function bind(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  }
  contract.createTitleAsync = function* (args) {
    return yield createTitleAsync(admin, contract, args);
  }
  contract.createTitle = function* (args) {
    return yield createTitle(admin, contract, args);
  }
  contract.exists = function* (vin) {
    return yield exists(admin, contract, vin);
  }
  contract.getTitle = function* (vin) {
    return yield getTitle(admin, contract, vin);
  }
  contract.bindTitle = function* (address) {
    return yield bindTitle(admin, contract, address);
  }
  contract.setLienRelease = function* (args) {
    return yield setLienRelease(admin, contract, args);
  }
  contract.addLienHolder = function* (args) {
    return yield addLienHolder(admin, contract, args);
  }
  contract.setTitleDetails = function* (args) {
    return yield setTitleDetails(admin, contract, args);
  }

  return contract;
}

function* compileSearch(contract) {
  rest.verbose('compileSearch', contractName);

  if (yield rest.isSearchable(contract.codeHash)) {
    return;
  }
  // compile + dependencies
  const searchable = [titleJs.contractName, contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

// throws: ErrorCodes
// returns: new title address
function* createTitleAsync(admin, contract, args) {
  rest.verbose('createTitle', args);
  // function createTitle(string _vin) returns (ErrorCodes, address) {
  const method = 'createTitle';

  const result = yield rest.callMethod(admin, contract, method, util.usc(args));
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

function* setLienRelease(admin, contract, args) {
  rest.verbose('setLienRelease', args);
  // function setLienRelease(string _vin, string _date, string trackingNumber, string lienholderName ) return (ErrorCodes)
  const method = 'setLienRelease';
  const result = yield rest.callMethod(admin, contract, method, util.usc(args));
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error(errorCode);
  }
  return errorCode;
}

function* setTitleDetails(admin, contract, args) {
  rest.verbose("setTitleDetails", args);
  // function setTitleDetails(string _vin, uint _titleNumber, string _make,
  //                          string _state, string _modelYear, string _bodyStyle,
  //                          string _color) returns (ErrorCodes, address)
  const method = "setTitleDetails";
  const result = yield rest.callMethod(admin, contract, method, util.usc(args));
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error(errorCode);
  }
  return result;
}

// bind a title created from json, into the titles array
// throws: ErrorCodes
function* bindTitle(admin, contract, address) {
  rest.verbose('bindTitle', address);
  // function bindTitle(address _address) returns (ErrorCodes, address) {
  const method = 'bindTitle';
  const args = { address: address };
  const result = yield rest.callMethod(admin, contract, method, util.usc(args));
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error(errorCode);
  }
  return errorCode;
}

function* addLienHolder(admin, contract, args) {
  rest.verbose('addLienHolder', args);
  const method = 'addLienHolder';
  const result = yield rest.callMethod(admin, contract, method, util.usc(args));
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error(errorCode);
  }
  return errorCode;
}

// get a title by vin
// throws: ErrorCodes
function* getTitle(admin, contract, vin) {
  rest.verbose('getTitle', vin);
  // function getTitle(string _vin) returns (ErrorCodes, address) {
  const method = 'getTitle';
  const args = { vin: vin };
  const result = yield rest.callMethod(admin, contract, method, util.usc(args));
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error(errorCode);
  }
  // FIXME search the title by address when cirrus is fixed
  return result[1];
}

function* getByVin(vin) {
  console.log('titleManagerJs', 'getByVin', vin);
  return yield titleJs.getByVin(vin);
}

function* getAllTitles() {
  console.log('titleManagerJs', 'getAllTitles');
  return yield titleJs.getAll();
}

module.exports = {
  bind: bind,
  compileSearch: compileSearch,
  getByVin: getByVin,
  getAllTitles: getAllTitles,
  uploadContract: uploadContract,
  setLienRelease: setLienRelease,
  setTitleDetails: setTitleDetails,
  addLienHolder: addLienHolder,
  contractName: contractName,
  bindTitle: bindTitle
};
