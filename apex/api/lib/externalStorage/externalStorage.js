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
function* verifyHash(admin, contract, args, user) {
  rest.verbose('verifyHash', args);
  const signer = (user) ? user : admin;

  // function verifyHash(string _hash) public view onlyOwner {  
  const method = 'verifyHash';
  const result = yield rest.callMethod(signer, contract, method, args);
}

function* viewHash(admin, contract, args, user) {
  rest.verbose('viewHash', args);
  const signer = (user) ? user : admin;

  // function viewHash() public view onlyOwner returns (string, string, string) {
  const method = 'viewHash';
  const result = yield rest.callMethod(signer, contract, method, args);
}

module.exports = {
  compileSearch: compileSearch,
  uploadContract: uploadContract,
  verifyHash: verifyHash,
  viewHash: viewHash
};
