/* jshint esnext: true */

const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);
const constants = require(`${process.cwd()}/lib/rest-utils/constants`);
const restLite = require(`${process.cwd()}/lib/rest-utils/rest6-lite`);


const contractName = 'ExternalStorage';
const contractFilename = `./lib/externalStorage/contracts/ExternalStorage.sol`;


function* uploadContract(user, args) {
  const contract = yield restLite.uploadContract(user, contractName, contractFilename, args);
  const isContractCompiled = yield restLite.isSearchable(contract.codeHash);
  if (!isContractCompiled) {
    yield compileSearch();
  }

  contract.src = 'removed';
  return setContract(user, contract);
}

function setContract(admin, contract) {
  contract.getState = function* () {
    return yield restLite.getState(contract);
  };

  return contract;
}

function* compileSearch() {
  const searchable = [contractName];
  yield restLite.compileSearch(searchable, contractName, contractFilename);
}

// ================== contract methods ====================
function* attest(user, contractAddress, args) {
  let contract = {
    name: contractName,
    address: contractAddress
  }
  // function attest(bytes32 _signature) public view returns(bytes32[]) {
  const method = 'attest';
  const result = yield restLite.callMethodOAuth(user, contract, method, args);
  return result;
}

// ================== wrapper methods ====================
function* getExternalStorage(address) {
  console.log('aaa')
  const results = (yield restLite.waitQuery(`${contractName}?address=eq.${address}`, 1, 3 * 60 * 1000))[0];
  return results;
}




module.exports = {
  compileSearch,
  uploadContract,
  attest,
  getExternalStorage,
};
