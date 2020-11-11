
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

const path = require('path');

let config:Config=fsUtil.getYaml("config.yaml");
let options:Options={config}

const contractName = 'Title';
const contractFilename = path.join(config.contractsPath, "Title.sol");


async function uploadContract(admin, args) {
  const contract = <Contract> await rest.createContract(admin, {name: contractName, source: await importer.combine(contractFilename), args}, options);
  await compileSearch(admin);
  contract.src = 'removed';
  return bind(admin, contract);
}

function bind(admin, contract) {
  contract.getState = async function () {
    return await rest.getState(admin, contract, options);
  }
  return contract;
}

async function compileSearch(user) {
  console.log('compileSearch: ' + contractName);

//  if (await rest.isCompiled(contractName)) {
//    return;
//  }
  const searchable = [contractName];
  await rest.createContract(user, {name: contractName, source: await importer.combine(contractFilename), args: {}}, options);
}

// curl -i http://localhost/cirrus/search/Title?vin=eq.qwerty123456
async function getByVin(user, vin) {
  console.log('titleJs', 'getByVin', vin);
  const result = await rest.search(user, {name: contractName}, {...options, query: {vin: `eq.${vin}`}});
  return result[0];
}

async function waitForVin(user, vin) {
  console.log('titleJs', 'waitForVin', vin);
  const result = await rest.search(user, {name: contractName}, {...options, query: {vin: `eq.${vin}`}});
  return result[0];
}

//
async function _getByAddress(user, address) {
  console.log('titleJs', 'getByAddress', address);
  const result = await rest.search(user, {name: contractName}, {...options, query: {address: `eq.${address}`}});
  return result[0];
}

async function waitForAddress(user, address) {
  console.log('titleJs', 'waitForAddress', address);
  const result = await rest.search(user, {name: contractName}, {...options, query: {address: `eq.${address}`}});
  return result[0];
}

async function getAll(user) {
  const results = await rest.search(user, {name: contractName}, options);
  return results;
}

async function getTitles(user, addresses) {
  const csv = util.toCsv(addresses); // generate csv string
  const results = await rest.search(user, {name: contractName}, {...options, query: {address: `in.${csv}`}});
  return results;
}

module.exports = {
  uploadContract: uploadContract,
  getByVin: getByVin,
  getAll: getAll,
  getTitles: getTitles,
  _getByAddress: _getByAddress,
  waitForVin: waitForVin,
  waitForAddress: waitForAddress,
  compileSearch: compileSearch
};
