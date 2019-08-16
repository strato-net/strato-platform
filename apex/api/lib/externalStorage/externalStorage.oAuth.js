/* jshint esnext: true */

const co = require('co');

const contractName = 'ExternalStorage';
const contractFilename = `./lib/externalStorage/contracts/ExternalStorage.sol`;
const restLite = require(`${process.cwd()}/lib/rest-utils/rest6-lite`);


async function uploadContract(user, args) {
  const contract = await co(restLite.uploadContract(user, contractName, contractFilename, args));
  const isContractCompiled = await co(restLite.isSearchable(contract.codeHash));
  if (!isContractCompiled) {
    await co(compileSearch());
  }

  contract.src = 'removed';
  return setContract(user, contract);
}

async function setContract(admin, contract) {
  contract.getState = async function () {
    return await co(restLite.getState(contract));
  };

  return contract;
}

async function compileSearch() {
  const searchable = [contractName];
  await co(restLite.compileSearch(searchable, contractName, contractFilename));
}

// ================== contract methods ====================
async function attest(user, contractAddress, args) {
  let contract = {
    name: contractName,
    address: contractAddress
  }
  // function attest(bytes32 _signature) public view returns(bytes32[]) {
  const method = 'attest';
  return await co(restLite.callMethodOAuth(user, contract, method, args));
}

// ================== wrapper methods ====================
async function getExternalStorage(address) {
  return (await co(restLite.waitQuery(`${contractName}?address=eq.${address}`, 1, 3 * 60 * 1000)))[0];
}


module.exports = {
  compileSearch,
  uploadContract,
  attest,
  getExternalStorage,
};
