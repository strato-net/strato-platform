// Load environment variables from .env file.
require('dotenv').config();

const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');

// Load configuration from a YAML file.
const config = fsUtil.getYaml(`../config.yaml`);

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
 * Splits an array into batches of a given size.
 *
 * @param {Array} arr - The array to split.
 * @param {number} batchSize - The maximum size of each batch.
 * @returns {Array<Array>} - An array of batches.
 */
const batchArray = (arr, batchSize) => {
  const batches = [];
  for (let i = 0; i < arr.length; i += batchSize) {
    batches.push(arr.slice(i, i + batchSize));
  }
  return batches;
};

/**
 * Helper function to call a contract method and poll until completion.
 *
 * @param {Object} token - The token object.
 * @param {Object} callArgs - The call arguments.
 * @returns {Promise<Object>} - The final result of the call.
 */
const callAndWait = async (token, callArgs) => {
  const options = { config, cacheNonce: true, isAsync: true };
  const callResponse = await rest.call(token, callArgs, options);
  const responseArray = Array.isArray(callResponse)
    ? callResponse
    : [callResponse];

  // Poll until there are no pending transactions.
  const predicate = (results) =>
    results.filter((r) => r.status === 'Pending').length === 0;
  const action = async (options) =>
    rest.getBlocResults(
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
 * Calls the old reserve's migrateReserve function for a batch of escrows.
 *
 * @param {Object} token - The token object.
 * @param {string} oldReserveAddress - The old reserve address.
 * @param {string} newReserveAddress - The new reserve address.
 * @param {Array<string>} escrowBatch - Batch of escrow addresses.
 */
const migrateBatch = async (
  token,
  oldReserveAddress,
  newReserveAddress,
  escrowBatch
) => {
  const callArgs = {
    contract: { address: oldReserveAddress },
    method: 'migrateReserve',
    args: util.usc({
      newReserve: newReserveAddress,
      escrows: escrowBatch,
    }),
  };
  console.log(`Migrating batch: ${JSON.stringify(escrowBatch)}`);
  const finalResults = await callAndWait(token, callArgs);
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== 'Success') {
    throw new Error(
      `Error: migrateReserve failed for batch ${JSON.stringify(escrowBatch)}`
    );
  }
  console.log(`Batch migrated successfully.`);
};

/**
 * Calls the new reserve's updateOldEscrowData function for a batch of escrows.
 *
 * @param {Object} token - The token object.
 * @param {string} newReserveAddress - The new reserve address.
 * @param {Array<string>} escrowBatch - Batch of escrow addresses.
 */
const updateOldEscrowDataBatch = async (
  token,
  newReserveAddress,
  escrowBatch
) => {
  const callArgs = {
    contract: { address: newReserveAddress },
    method: 'updateOldEscrowData',
    args: util.usc({
      escrows: escrowBatch,
    }),
  };
  console.log(
    `Updating old escrow data for batch: ${JSON.stringify(escrowBatch)}`
  );
  const finalResults = await callAndWait(token, callArgs);
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== 'Success') {
    throw new Error(
      `Error: updateOldEscrowData failed for batch ${JSON.stringify(
        escrowBatch
      )}`
    );
  }
  console.log(`updateOldEscrowData for batch succeeded.`);
};

/**
 * Calls the new reserve's updateOldEscrowBorrowData function for a batch of escrows.
 *
 * @param {Object} token - The token object.
 * @param {string} newReserveAddress - The new reserve address.
 * @param {Array<string>} escrowBatch - Batch of escrow addresses.
 */
const updateOldEscrowBorrowDataBatch = async (
  token,
  newReserveAddress,
  escrowBatch
) => {
  const callArgs = {
    contract: { address: newReserveAddress },
    method: 'updateOldEscrowBorrowData',
    args: util.usc({
      escrows: escrowBatch,
    }),
  };
  console.log(
    `Updating old escrow borrow data for batch: ${JSON.stringify(escrowBatch)}`
  );
  const finalResults = await callAndWait(token, callArgs);
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== 'Success') {
    throw new Error(
      `Error: updateOldEscrowBorrowData failed for batch ${JSON.stringify(
        escrowBatch
      )}`
    );
  }
  console.log(`updateOldEscrowBorrowData for batch succeeded.`);
};

async function main() {
  try {
    // Validate required environment variables.
    const { USERNAME, PASSWORD, OLD_RESERVE_ADDRESS, NEW_RESERVE_ADDRESS } =
      process.env;
    if (!USERNAME || !PASSWORD) {
      throw new Error(
        'USERNAME and PASSWORD environment variables are required.'
      );
    }
    if (!OLD_RESERVE_ADDRESS) {
      throw new Error('OLD_RESERVE_ADDRESS environment variable is required.');
    }
    if (!NEW_RESERVE_ADDRESS) {
      throw new Error('NEW_RESERVE_ADDRESS environment variable is required.');
    }

    // 1. Obtain the user token.
    const tokenString = await getUserToken(USERNAME, PASSWORD);
    if (!tokenString) {
      throw new Error('Failed to acquire token.');
    }
    console.log('Token acquired:', tokenString);
    const token = { token: tokenString };

    // 2. Fetch active escrow addresses for the old reserve.
    const escrowQuery = {
      config,
      query: {
        reserve: 'eq.' + OLD_RESERVE_ADDRESS,
        isActive: 'eq.true',
        creator: 'eq.BlockApps',
        select: 'address',
      },
    };

    const escrowResults = await rest.search(
      token,
      { name: 'BlockApps-Mercata-Escrow' },
      escrowQuery
    );
    const escrowAddresses =
      escrowResults && escrowResults.length > 0
        ? escrowResults.map((escrow) => escrow.address)
        : [];

    if (escrowAddresses.length === 0) {
      console.log(
        `No active escrows found for reserve ${OLD_RESERVE_ADDRESS}. Nothing to migrate.`
      );
      return;
    }

    console.log(
      `Found ${escrowAddresses.length} escrow(s) for reserve ${OLD_RESERVE_ADDRESS}.`
    );

    // 3. Partition the escrow addresses into batches of 10.
    const batches = batchArray(escrowAddresses, 10);
    console.log(`Partitioned escrows into ${batches.length} batch(es).`);

    // 4. For each batch, perform migration and call the two update functions.
    for (const batch of batches) {
      // Migrate the batch on the old reserve.
      await migrateBatch(
        token,
        OLD_RESERVE_ADDRESS,
        NEW_RESERVE_ADDRESS,
        batch
      );

      // On the new reserve, update the escrow data.
      await updateOldEscrowDataBatch(token, NEW_RESERVE_ADDRESS, batch);

      // On the new reserve, update the escrow borrow data.
      await updateOldEscrowBorrowDataBatch(token, NEW_RESERVE_ADDRESS, batch);
    }

    console.log('Reserve migration and updates completed successfully.');
  } catch (error) {
    console.error('Fatal error during reserve migration:', error);
  }
}

main();
