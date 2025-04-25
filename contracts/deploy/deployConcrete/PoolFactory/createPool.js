require('dotenv').config();
const axios = require('axios');
const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');
const config = fsUtil.getYaml(`../../config.yaml`);
const auth = require('../../auth');

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
    const USERNAME = getEnvVar('USERNAME');
    const PASSWORD = getEnvVar('PASSWORD');
    const TOKEN_A_ADDRESS = getEnvVar('TOKEN_A_ADDRESS');
    const TOKEN_B_ADDRESS = getEnvVar('TOKEN_B_ADDRESS');
    const POOL_FACTORY_ADDRESS = getEnvVar('POOL_FACTORY_ADDRESS');

    // Obtain the first access token.
    console.log('Obtaining first access token...');
    let token = await auth.getUserToken(USERNAME, PASSWORD);
    console.log('Access token of owner:', token);

    // Call createPool.
    console.log('Calling createPool...');
    // Prepare call arguments for the createPool call.
    let callListArgs = [
      {
        contract: { address: POOL_FACTORY_ADDRESS, name: 'SimplePoolFactory' },
        method: 'createPool',
        args: util.usc({
          tokenAAddr: TOKEN_A_ADDRESS,
          tokenBAddr: TOKEN_B_ADDRESS,
        }),
      },
    ];
    const finalResults = await callListAndWait({ token: token }, callListArgs);
    console.log(
      'createPool result:',
      JSON.stringify(finalResults, null, 2)
    );
  } catch (error) {
}
}

main();
