// Load environment variables from .env file.
require('dotenv').config();

const fs = require('fs');
const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');
const config = fsUtil.getYaml(`../config.yaml`);

/**
 * Append error details to a log file.
 *
 * @param {string} message - The error message or context.
 * @param {Error|any} error - The error object or error details.
 */
function logError(message, error) {
  let errorDetails;
  try {
    // Try to stringify the error object for a more detailed view.
    errorDetails = JSON.stringify(error, null, 2);
  } catch (jsonError) {
    // Fallback in case JSON.stringify fails.
    errorDetails = error.toString();
  }
  const errorLog = `[${new Date().toISOString()}] ${message}: ${errorDetails}\n`;
  fs.appendFileSync('error.log', errorLog, { flag: 'a' });
}

/**
 * Generates a unique identifier.
 *
 * @param {string|null} prefix - Optional prefix.
 * @param {number} digits - Number of digits (max 16).
 * @returns {string} - The unique ID.
 */
function uid(prefix = null, digits = 6) {
  digits = Math.max(1, Math.min(16, digits));
  const max = Math.pow(10, digits);
  const randomNumber = Math.floor(Math.random() * max);
  const padded = randomNumber.toString().padStart(digits, '0');
  return prefix ? `${prefix}_${padded}` : padded;
}

/**
 * Sums quantities by owner from a response array.
 *
 * @param {Array<Object>} responseData - Array of objects with owner and quantity.
 * @returns {Array} - An array of [owner, totalQuantity] pairs.
 */
function transformResponseToTupleList(responseData) {
  const ownerQuantities = new Map();
  for (const item of responseData) {
    const owner = item.owner;
    const quantity = Number(item.quantity);
    ownerQuantities.set(
      owner,
      BigInt(ownerQuantities.get(owner) ?? 0) + BigInt(quantity)
    );
  }
  return Array.from(ownerQuantities.entries());
}

/**
 * Splits an array into batches of a given size.
 *
 * @param {Array} arr - The array to split.
 * @param {number} batchSize - The maximum size of each batch.
 * @returns {Array<Array>} - Array of batches.
 */
const batchArray = (arr, batchSize) => {
  const batches = [];
  for (let i = 0; i < arr.length; i += batchSize) {
    batches.push(arr.slice(i, i + batchSize));
  }
  return batches;
};

/**
 * Obtains a user token using OAuth resource owner credentials.
 *
 * @param {string} username - The username.
 * @param {string} password - The password.
 * @param {Object|null} req - Optional request object.
 * @returns {Promise<string>} - The access token.
 */
const TOKEN_LIFE_THRESHOLD_SECONDS = 30;
let CACHED_DATA = {
  token: null,
  tokenExpiresAt: null,
};

const getToken = async (username, password, req = null) => {
  let token = CACHED_DATA.token;
  const expiresAt = CACHED_DATA.tokenExpiresAt;
  if (
    !token ||
    !expiresAt ||
    expiresAt <= Math.floor(Date.now() / 1000) + TOKEN_LIFE_THRESHOLD_SECONDS
  ) {
    const tokenObj = await getUserToken(username, password, req);
    token = tokenObj.token['access_token'];
    CACHED_DATA.token = token;
    CACHED_DATA.tokenExpiresAt = Math.floor(tokenObj.token.expires_at / 1000);
  }
  return token;
};
const getUserToken = async (username, password, req = null) => {
  const oauth = req
    ? req.app.oauth
    : await oauthUtil.init(config.nodes[0].oauth);
  return await oauth.getAccessTokenByResourceOwnerCredential(
    username,
    password
  );
};

/**
 * Generates call arguments for the automaticTransfer function.
 *
 * @param {string} address - The new owner address.
 * @param {number} balance - The balance to transfer.
 * @returns {Object} - The call argument object.
 */
function generateCallArgs(address, balance) {
  return {
    contract: { address: process.env.USDST_TOKEN, name: 'Tokens' },
    method: 'automaticTransfer',
    args: util.usc({
      newOwner: address,
      price: 0.000000000000000001,
      quantity: (BigInt(balance) * BigInt(10 ** 14)).toString(),
      transferNumber: parseInt(uid(null, 6), 10),
    }),
  };
}

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

async function main() {
  try {
    const { USERNAME, PASSWORD, STRAT_TOKEN, USDST_TOKEN } = process.env;

    if (!USERNAME || !PASSWORD || !STRAT_TOKEN || !USDST_TOKEN) {
      throw new Error(
        'One or more required environment variables are not set.'
      );
    }

    // 1. Obtain the user token.
    const tokenString = await getToken(USERNAME, PASSWORD);
    if (!tokenString) {
      throw new Error('Failed to acquire token.');
    }
    let token = { token: tokenString };

    // 2. Build the query to fetch balances.
    const balancesQuery = {
      select: 'owner,quantity',
      root: 'eq.' + STRAT_TOKEN,
      ownerCommonName: 'neq.' + USERNAME,
      quantity: 'gt.0',
    };

    // Use rest.search to query the asset balances.
    const balancesResult = await rest.search(
      token,
      { name: 'BlockApps-Mercata-Asset' },
      { config, query: balancesQuery }
    );
    const balances = transformResponseToTupleList(balancesResult);

    if (balances.length === 0) {
      console.log('No balances found.');
      return;
    }

    // 3. Process balances in chunks.
    const chunkSize = 20;
    const batches = batchArray(balances, chunkSize);

    for (let i = 0; i < batches.length; i++) {
      const chunk = batches[i];
      // Build a list of call arguments for each transfer.
      const callListArgs = chunk.map(([address, balance]) =>
        generateCallArgs(address, balance)
      );

      // Execute the batch of calls and wait for confirmation.
      token = { token: await getToken(USERNAME, PASSWORD) };
      const finalResults = await callListAndWait(token, callListArgs);
      const hasErrors = finalResults.some(
        (result) => result.status !== 'Success'
      );

      if (hasErrors) {
        console.error(`Error in chunk ${i + 1}:`, finalResults);
        const errors = finalResults.filter(result => result.status !== 'Success');
        logError(`Error in chunk ${i + 1}`, errors);
      } else {
        console.log(`Chunk ${i + 1} posted successfully.`);
        console.log(chunk);
      }
    }
  } catch (error) {
    console.error('Fatal error:', error);
    logError("Fatal error in main", error);
  }
}

main();
