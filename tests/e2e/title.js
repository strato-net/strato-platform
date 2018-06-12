const ba = require('blockapps-rest');
const rest = ba.rest;
const util = ba.common.util;
const config = ba.common.config;
const path = require('path');

const contractName = 'Title';
const contractFilename = path.join(config.contractsPath, "Title.sol");


function* uploadContract(admin, args) {
  const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
  yield compileSearch();
  contract.src = 'removed';
  return bind(admin, contract);
}

function bind(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  }
  return contract;
}

function* compileSearch() {
  rest.verbose('compileSearch', contractName);

  if (yield rest.isCompiled(contractName)) {
    return;
  }
  const searchable = [contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

// curl -i http://localhost/cirrus/search/Title?vin=eq.qwerty123456
function* getByVin(vin) {
  console.log('titleJs', 'getByVin', vin);
  const result = yield rest.query(`${contractName}?vin=eq.${vin}`);
  return result[0];
}

function* waitForVin(vin) {
  console.log('titleJs', 'waitForVin', vin);
  const result = yield rest.waitQuery(`${contractName}?vin=eq.${vin}`, 1);
  return result[0];
}

//
function* _getByAddress(address) {
  console.log('titleJs', 'getByAddress', address);
  const result = yield rest.query(`${contractName}?address=eq.${address}`);
  return result[0];
}

function* waitForAddress(address) {
  console.log('titleJs', 'waitForAddress', address);
  const result = yield rest.waitQuery(`${contractName}?address=eq.${address}`, 1);
  return result[0];
}

function* getAll() {
  const results = yield rest.query(`${contractName}`);
  return results;
}

function* getTitles(addresses) {
  const csv = util.toCsv(addresses); // generate csv string
  const results = yield rest.query(`${contractName}?address=in.${csv}`);
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
