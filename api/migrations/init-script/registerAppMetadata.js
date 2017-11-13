const blockappsRest = require('blockapps-rest').rest;

/**
 Compile and send the AppMetadata contract abi to cirrus
 */
module.exports = registerAppMetadata = function() {
  return blockappsRest.compileSearch(['AppMetadata'], 'AppMetadata', 'lib/appMetadata/contracts/AppMetadata.sol');
};