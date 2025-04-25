const config = require('../../config');
const axios = require('axios');
const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');
const auth = require('../../auth');
const fs = require('fs');
const path = require('path');

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
    const GLOBAL_ADMIN_NAME = getEnvVar('GLOBAL_ADMIN_NAME');
    const GLOBAL_ADMIN_PASSWORD = getEnvVar('GLOBAL_ADMIN_PASSWORD');
    const TOKEN_A_ADDRESS = getEnvVar('TOKEN_A_ADDRESS');
    const TOKEN_B_ADDRESS = getEnvVar('TOKEN_B_ADDRESS');
    const POOL_FACTORY_ADDRESS = getEnvVar('POOL_FACTORY_ADDRESS');

    // Obtain the first access token.
    console.log('Obtaining first access token...');
    let token = await auth.getUserToken(GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD);
    console.log('Access token of owner:', token);

    // Call createPool.
    console.log('Calling createPool...');
    // Prepare call arguments for the createPool call.
    let callListArgs = [
      {
        contract: { address: POOL_FACTORY_ADDRESS, name: 'SimplePoolFactory' },
        method: 'createPool',
        args: {
          tokenA: TOKEN_A_ADDRESS,
          tokenB: TOKEN_B_ADDRESS,
        },
      },
    ];
    const finalResults = await callListAndWait({ token: token }, callListArgs);
    console.log(
      'createPool result:',
      JSON.stringify(finalResults, null, 2)
    );
    
    // Store pool creation information in a text file
    const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
    const poolInfo = {
      operation: 'Pool Creation',
      timestamp: new Date().toISOString(),
      factoryAddress: POOL_FACTORY_ADDRESS,
      tokenA: TOKEN_A_ADDRESS,
      tokenB: TOKEN_B_ADDRESS,
      transactionHash: final.hash,
      status: final.status,
      poolAddress: final.status === 'Success' ? final.txResult.contractsCreated : 'Failed'
    };
    
    const deploymentDir = path.join(__dirname, 'deployment-logs');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }
    
    const filename = `Pool-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const filePath = path.join(deploymentDir, filename);
    
    const content = JSON.stringify(poolInfo, null, 2);
    fs.writeFileSync(filePath, content);
    
    console.log(`Pool creation information saved to: ${filePath}`);
  } catch (error) {
    console.error('Fatal error in pool creation:', error);
  }
}

main();
