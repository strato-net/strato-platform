/* jshint esnext: true */
const blockappsRest = require('blockapps-rest').rest;
const rp = require('request-promise');

/**
 Compile and send the AppMetadata contract abi to cirrus
 */
module.exports = registerAppMetadata = async function() {
  const contract = await blockappsRest.compileSearch(['AppMetadata'],
                                                     'AppMetadata',
                                                     'lib/appMetadata/contracts/AppMetadata.sol');
  console.log("The contract looks like: " + JSON.stringify(contract));
  const options = {
    method: 'POST',
    uri: `${process.env.cirrusRoot}/contracts`,
    body: JSON.stringify(contract),
  }
  await rp(options);
  return contract;
};
