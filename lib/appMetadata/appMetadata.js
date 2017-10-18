const ba = require('blockapps-rest');
const rest = ba.rest;
const util = ba.common.util;
const config = ba.common.config;
const BigNumber = ba.common.BigNumber;
const constants = ba.common.constants

const contractName = 'AppMetadata';
const contractFilename = `./lib/appMetadata/contracts/AppMetadata.sol`;

function* uploadContract(admin, args) {
  const contract = yield rest.uploadContract(admin, contractName, contractFilename, args);
  yield compileSearch(contract);
  contract.src = 'removed';
  return setContract(admin, contract);
}

function setContract(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  }

  contract.update = function* (args, user) {
    return yield update(admin,contract, args, user);
  }

  return contract;
}

function* compileSearch(contract) {
  rest.verbose('compileSearch', contractName);
  if (yield rest.isCompiled(contract.codeHash)) {
    return;
  }
  const searchable = [contractName];
  yield rest.compileSearch(searchable, contractName, contractFilename);
}

// ================== contract methods ====================
function* update(admin, contract, args, user) {
  rest.verbose('update', args);
  const signer = (user) ? user : admin

  // function update( string _appName, string _version, string _maintainer
  //                 , string _url, string _description ) onlyOwner {
  const method = 'update';
  const result = yield rest.callMethod(signer, contract, method, args);
}

// ================== wrapper methods ====================
function* getAppMetadata(address) {
  const results = (yield rest.waitQuery(`${contractName}?address=eq.${address}`, 1, 3*60*1000))[0];
  return results;
}

module.exports = {
  uploadContract: uploadContract,
  //
  getAppMetadata: getAppMetadata,
};
