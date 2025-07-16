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
function logError(message, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    message,
    ...details,
  };

  // Convert to string with pretty-printing for readability.
  const errorLog = JSON.stringify(logEntry, null, 2) + '\n';
  fs.appendFileSync('error.log', errorLog, { flag: 'a' });
}
/**
 * Sums quantities by owner (and preserves ownerCommonName) from a response array.
 *
 * @param {Array<Object>} responseData - Array of objects with owner, ownerCommonName, and quantity.
 * @returns {Array} - An array of tuples: [owner, ownerCommonName, totalQuantity].
 */
function transformResponseToTupleList(responseData) {
  const ownerMap = new Map();
  for (const item of responseData) {
    const owner = item.owner;
    const ownerCommonName = item.ownerCommonName;
    const quantity = BigInt(item.quantity);
    if (ownerMap.has(owner)) {
      const record = ownerMap.get(owner);
      record.quantity += quantity;
    } else {
      ownerMap.set(owner, { ownerCommonName, quantity });
    }
  }
  return Array.from(ownerMap.entries()).map(([owner, data]) => [
    owner,
    data.ownerCommonName,
    data.quantity,
  ]);
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

const TOKEN_LIFE_THRESHOLD_SECONDS = 30;
let CACHED_DATA = {
  token: null,
  tokenExpiresAt: null,
};

/**
 * Obtains a user token using OAuth resource owner credentials.
 *
 * @param {string} username - The username.
 * @param {string} password - The password.
 * @param {Object|null} req - Optional request object.
 * @returns {Promise<string>} - The access token.
 */
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
 * @param {number|string|BigInt} balance - The balance to transfer.
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
      transferNumber: util.iuid(),
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

/**
 * Writes the CSV file from the balancesMap.
 *
 * @param {Map} balancesMap - Map with key as owner and value as an object containing owner, ownerCommonName, stratBalance, usdstBalance.
 */
function writeCsvFile(balancesMap) {
  const header = 'owner,ownerCommonName,stratBalance,usdstBalance\n';
  const rows = [];
  for (const [owner, data] of balancesMap) {
    const strat = data.stratBalance.toString();
    const usdst = data.usdstBalance;
    rows.push(`${owner},${data.ownerCommonName},${strat},${usdst}`);
  }
  const content = header + rows.join('\n');
  fs.writeFileSync('balances.csv', content);
}

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

    // 2. Build the query to fetch STRAT token balances.
    const balancesQuery = {
      select: 'owner,ownerCommonName,quantity',
      root: 'eq.' + STRAT_TOKEN,
      ownerCommonName: 'neq.' + USERNAME,
      quantity: 'gt.0',
    };

    // Query the asset balances.
    const balancesResult = await rest.search(
      token,
      { name: 'BlockApps-Mercata-Asset' },
      { config, query: balancesQuery }
    );
    const stratBalances = transformResponseToTupleList(balancesResult);

    if (stratBalances.length === 0) {
      console.log('No STRAT balances found.');
      return;
    }

    // Create an in-memory map to store CSV row data.
    const balancesMap = new Map();
    for (const [owner, ownerCommonName, stratBalance] of stratBalances) {
      balancesMap.set(owner, {
        owner,
        ownerCommonName,
        stratBalance,
        usdstBalance: '', // initially empty
      });
    }

    // Write the initial CSV file with the first three columns populated.
    writeCsvFile(balancesMap);

    // 3. Process STRAT balances in chunks for transfer.
    const chunkSize = 20;
    const batches = batchArray(stratBalances, chunkSize);

    for (let i = 0; i < batches.length; i++) {
      const chunk = batches[i];
      // Prepare batch info: for each record in the chunk, store owner and computed transferQuantity.
      const batchInfo = chunk.map(([owner, ownerCommonName, stratBalance]) => {
        const transferQuantity = (
          BigInt(stratBalance) * BigInt(10 ** 14)
        ).toString();
        return { owner, ownerCommonName, stratBalance, transferQuantity };
      });
      // Build call arguments for each transfer.
      const callListArgs = batchInfo.map((info) =>
        generateCallArgs(info.owner, info.stratBalance)
      );

      // Refresh token before each batch.
      token = { token: await getToken(USERNAME, PASSWORD) };
      const finalResults = await callListAndWait(token, callListArgs);

      // Update the CSV map based on the results for this batch.
      for (let j = 0; j < batchInfo.length; j++) {
        const { owner, transferQuantity } = batchInfo[j];
        if (finalResults[j] && finalResults[j].status === 'Success') {
          balancesMap.get(owner).usdstBalance = transferQuantity;
        } else {
          balancesMap.get(owner).usdstBalance = 'failure';
          logError(`Error in chunk ${i + 1}`, {
            txResult: finalResults[j],
            callArgs: callListArgs[j],
          });
        }
      }

      // Update CSV file in real time after processing this batch.
      writeCsvFile(balancesMap);
      console.log(`Batch ${i + 1} processed and CSV updated.`);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    logError('Fatal error in main', error);
  }
}

main();
