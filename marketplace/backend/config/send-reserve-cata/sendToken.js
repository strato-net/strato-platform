require('dotenv').config();
const axios = require('axios');
const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');
const config = fsUtil.getYaml(`../../config.yaml`);

/**
 * Obtains a user token using OAuth resource owner credentials.
 *
 * @param {string} username - The username.
 * @param {string} password - The password.
 * @param {object|null} req - (Optional) Request object.
 * @returns {Promise<string>} - The access token.
 */
const getUserToken = async (username, password, req = null) => {
  const oauth = req
    ? req.app.oauth
    : await oauthUtil.init(config.nodes[0].oauth);
  const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
    username,
    password
  );
  const tokenField = config.nodes[0].oauth.tokenField || 'access_token';
  return tokenObj.token[tokenField];
};

/**
 * Calls a list of function calls and polls until all transactions have completed.
 *
 * @param {Object} token - The token object.
 * @param {Array} callListArgs - Array of call arguments.
 * @returns {Promise<Array>} - Final transaction results.
 */
const callListAndWait = async (token, callListArgs) => {
  const options = { config, cacheNonce: true, isAsync: true };
  const pendingTxResultList = await rest.callList(token, callListArgs, options);
  const responseArray = Array.isArray(pendingTxResultList)
    ? pendingTxResultList
    : [pendingTxResultList];

  // Poll until there are no pending transactions.
  const predicate = (results) =>
    results.filter((r) => r.status === 'Pending').length === 0;
  const action = async (options) =>
    await rest.getBlocResults(
      token,
      responseArray.map((r) => r.hash),
      options
    );
  const finalResults = await util.until(
    predicate,
    action,
    { config, isAsync: true },
    3600000
  );
  return finalResults;
};

/**
 * Obtains an environment variable.
 * Throws an error if the variable is not set.
 * @param {string} name - The environment variable name.
 * @returns {string} - The environment variable value.
 */
function getEnvVar(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

async function main() {
  try {
    const CATA_USERNAME = getEnvVar('CATA_USERNAME');
    const CATA_PASSWORD = getEnvVar('CATA_PASSWORD');
    const RESERVE_OWNER_USERNAME = getEnvVar('RESERVE_OWNER_USERNAME');
    const RESERVE_OWNER_PASSWORD = getEnvVar('RESERVE_OWNER_PASSWORD');
    const CATA_ADDRESS = getEnvVar('CATA_ADDRESS');
    const RESERVE_ADDRESS = getEnvVar('RESERVE_ADDRESS');
    const CATA_QUANTITY = getEnvVar('CATA_QUANTITY');

    // Obtain the first access token.
    console.log('Obtaining first access token...');
    let token = await getUserToken(CATA_USERNAME, CATA_PASSWORD);
    console.log('Access token of cata token owner:', token);

    // Call automaticTransfer.
    console.log('Calling automaticTransfer...');
    // Prepare call arguments for the automaticTransfer call.
    let callListArgs = [
      {
        contract: { address: CATA_ADDRESS, name: 'Tokens' },
        method: 'automaticTransfer',
        args: util.usc({
          newOwner: RESERVE_ADDRESS,
          price: 0.1,
          quantity: `${CATA_QUANTITY}`,
          transferNumber: util.iuid(),
        }),
      },
    ];
    const finalResults = await callListAndWait({ token: token }, callListArgs);
    console.log(
      'automaticTransfer result:',
      JSON.stringify(finalResults, null, 2)
    );

    // Extract newly created cata token from the result.
    // This mimics: jq -r '.[0].txResult.contractsCreated'
    if (!Array.isArray(finalResults) || finalResults.length === 0) {
      throw new Error('Invalid automaticTransfer result');
    }
    const newTokenAddress = finalResults[0]?.txResult?.contractsCreated[0];
    console.log(
      'New CATA token address (from automaticTransfer):',
      newTokenAddress
    );

    // Call setCATAToken.
    console.log('Calling setCATAToken...');
    callListArgs = [
      {
        contract: { address: RESERVE_ADDRESS, name: 'SimpleReserve' },
        method: 'setCataToken',
        args: util.usc({
          newCataToken: newTokenAddress,
        }),
      },
    ];
    token = await getUserToken(RESERVE_OWNER_USERNAME, RESERVE_OWNER_PASSWORD);
    const updateResult = await callListAndWait({ token: token }, callListArgs);
    console.log('setCATAToken result:', JSON.stringify(updateResult, null, 2));
  } catch (error) {
    console.error('Error during processing:', error.message);
    if (error.response && error.response.data) {
      console.error('Response data:', error.response.data);
    }
  }
}

main();
