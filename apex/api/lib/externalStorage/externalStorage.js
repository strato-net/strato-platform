/* jshint esnext: true */
const ba = require('blockapps-rest');
const rest = ba.rest;

const contractName = 'ExternalStorage';
const contractFilename = `./lib/externalStorage/contracts/ExternalStorage.sol`;

function* uploadContract(admin, args) {
  const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
  const isContractCompiled = yield rest.isSearchable(contract.codeHash);
  if (!isContractCompiled) {
    yield compileSearch();
  }

  contract.src = 'removed';
  return setContract(admin, contract);
}

function setContract(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  };

  return contract;
}

function* compileSearch() {
  rest.verbose('compileSearch', contractName);
  const searchable = [contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

// ================== contract methods ====================
function* attest(user, contractAddress, args) {
  rest.verbose('attest', args);
  let contract = {
    name: contractName,
    address: contractAddress
  }
  // function attest(bytes32 _signature) public view returns(bytes32[]) {
  const method = 'attest';
  const result = yield rest.callMethod(user, contract, method, args);
  return result;
}

// ================== wrapper methods ====================
function* getExternalStorage(address) {
  const results = (yield rest.waitQuery(`${contractName}?address=eq.${address}`, 1, 3 * 60 * 1000))[0];
  return results;
}

module.exports = {
  compileSearch: compileSearch,
  uploadContract: uploadContract,
  attest: attest,
  getExternalStorage: getExternalStorage
};
