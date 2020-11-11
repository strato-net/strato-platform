import * as path from "path";

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Config,
  Contract,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  constants,
  importer,
  parser
  } from 'blockapps-rest';

const titleJs = require('./title')

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

const ErrorCodes = parser.parseEnum(fsUtil.get(path.join(config.contractsPath, 'ErrorCodes.sol')));
const contractName = 'TitleManager';
const contractFilename = path.join(config.contractsPath, 'TitleManager.sol');

async function uploadContract(admin) {
  // NOTE: in production, the contract is created and owned by the AdminInterface
  // for testing purposes the creator is the admin user
  const args = {_creator: admin.address};
  const contract = <Contract> await rest.createContract(admin, {name: contractName, source: await importer.combine(contractFilename), args}, options);
  await compileSearch(admin, contract.codeHash);
  contract.src = 'removed';
  return bind(admin, contract);
}

function bind(admin, contract) {
  contract.getState = async function() {
    return await rest.getState(admin, contract, options);
  }
  contract.createTitleAsync = async function(args) {
    return await createTitleAsync(admin, contract, args);
  }
  contract.createTitle = async function(args) {
    return await createTitle(admin, contract, args);
  }
  contract.exists = async function(vin) {
    return await exists(admin, contract, vin);
  }
  return contract;
}

async function compileSearch(user, codeHash) {
  console.log('compileSearch:' + contractName);

//  if (await rest.isSearchable(codeHash)) {
//    return;
//  }

  // compile dependencies
  await titleJs.compileSearch();
  {
    const contractName = 'TitleMo';
    const contractFilename = `${config.contractsPath}/TitleMo.sol`;
    await rest.createContract(user, {name: contractName, source: await importer.combine(contractFilename), args: {}}, options);
  }

  const searchable = [contractName];
  await rest.createContract(user, {name: contractName, source: await importer.combine(contractFilename), args: {}}, options);
}

// throws: ErrorCodes
// returns: new title address
async function createTitleAsync(admin, contract, args) {
  console.log('createTitle: ' + args);
  // function createTitle(string _vin) returns (ErrorCodes, address) {
  const method = 'createTitle';

  const result = await rest.call(admin, {contract, method, args}, options);
  const errorCode = parseInt(result[0]);
  if (errorCode != ErrorCodes.SUCCESS) {
    throw new Error("" + errorCode);
  }
  // TODO test if valid address
  return result[1];
}

// blocks until title appears in search
// throws: ErrorCodes
// returns: new title as returned form search
async function createTitle(admin, contract, args) {
  console.log('createTitle: ' + args);
  // function createTitle(string _vin) returns (ErrorCodes, address) {
  const address = await createTitleAsync(admin, contract, args);
  const title = await titleJs.waitForAddress(address);
  return title;
}

async function exists(admin, contract, vin) {
  console.log('exists: ' + vin);
  // function exists(string vin) returns (bool) {
  const method = 'exists';
  const args = {
    vin: vin,
  };
  const result = await rest.call(admin, {contract, method, args}, options);
  const exists = (result[0] === true);
  return exists;
}

async function getByVin(vin) {
  console.log('titleManagerJs', 'getByVin', vin);
  return await titleJs.getByVin(vin);
}

module.exports = {
  bind: bind,
  compileSearch: compileSearch,
  getByVin: getByVin,
  uploadContract: uploadContract,
};
