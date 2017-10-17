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
  return setContract(admin, contract);
}

function setContract(admin, contract) {
  contract.getState = function* () {
    return yield rest.getState(contract);
  }
  return contract;
}

module.exports = {
  uploadContract: uploadContract,
  //
};
