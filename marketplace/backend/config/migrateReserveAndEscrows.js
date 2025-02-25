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

/**
 * Transfers the CATA token from the old reserve to the new reserve.
 *
 * This function performs the following steps:
 * 1. Queries the old reserve for its associated CATA token address.
 * 2. Retrieves the asset quantity and asset root for that CATA token.
 * 3. Initiates the transfer of the CATA token to the new reserve.
 * 4. Verifies the transfer by querying the new reserve's asset record.
 * 5. Updates the new reserve with the new CATA token address.
 *
 * @param {Object} token - The token object.
 * @param {string} OLD_RESERVE_ADDRESS - The old reserve address.
 * @param {string} NEW_RESERVE_ADDRESS - The new reserve address.
 * @returns {Promise<void>}
 * @throws Will throw an error if any step fails.
 */
async function transferCATAToNewReserve(
  token,
  token2,
  OLD_RESERVE_ADDRESS,
  NEW_RESERVE_ADDRESS
) {
  // 1. Query the old reserve to obtain its CATA token address.
  const reserveQuery = {
    query: { address: 'eq.' + OLD_RESERVE_ADDRESS },
    config,
  };

  const reserveResults = await rest.search(
    token,
    { name: 'BlockApps-Mercata-Reserve', select: 'cataToken' },
    reserveQuery
  );
  if (!reserveResults || reserveResults.length === 0) {
    throw new Error(`No reserve found for address ${OLD_RESERVE_ADDRESS}`);
  }
  const reserveRecord = reserveResults[0];
  const cataAddress = reserveRecord.cataToken;
  if (!cataAddress) {
    throw new Error(
      `No CATA token address found in reserve ${OLD_RESERVE_ADDRESS}`
    );
  }

  // 2. Query the asset table for the asset corresponding to the CATA token.
  const assetQuery = {
    query: { address: 'eq.' + cataAddress, select: 'quantity::text,root' },
    config,
  };

  const assetResults = await rest.search(
    token,
    { name: 'BlockApps-Mercata-Asset' },
    assetQuery
  );
  if (!assetResults || assetResults.length === 0) {
    throw new Error(`No asset found for CATA token address ${cataAddress}`);
  }
  const assetRecord = assetResults[0];
  const assetQuantity = assetRecord.quantity;

  // 3. Call transferCATAtoAnotherReserve
  let callListArgs = {
    contract: { address: OLD_RESERVE_ADDRESS },
    method: 'transferCATAtoAnotherReserve',
    args: util.usc({
      newOwner: NEW_RESERVE_ADDRESS,
      amount: assetQuantity,
    }),
  };
  const finalResults = await callAndWait(token, callListArgs);
  let final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== 'Success') {
    throw new Error(
      `Error: transferCATAtoAnotherReserve failed ${JSON.stringify(final)}`
    );
  }

  // Extract NEW_USDST_ADDRESS from the result.
  // This mimics: jq -r '.[0].txResult.contractsCreated'
  if (!Array.isArray(finalResults) || finalResults.length === 0) {
    throw new Error('Invalid automaticTransfer result');
  }
  const newTokenAddress = finalResults[0]?.txResult?.contractsCreated[0];
  console.log(
    'New CATA token address (from transferCATAtoAnotherReserve):',
    newTokenAddress
  );

  // 4. Call transferCATAtoAnotherReserve
  callListArgs = {
    contract: { address: NEW_RESERVE_ADDRESS },
    method: 'setCataToken',
    args: util.usc({
      newCataToken: newTokenAddress,
    }),
  };
  const updateResult = await callAndWait(token2, callListArgs);
  final = Array.isArray(updateResult) ? updateResult[0] : updateResult;
  if (final.status !== 'Success') {
    throw new Error(
      `Error: setCataToken failed ${JSON.stringify(final)}`
    );
  }
  console.log(`CATA transferred successfully.`);
}

async function main() {
  try {
    // Validate required environment variables.
    const { USERNAME, PASSWORD, USERNAME_NEW, PASSWORD_NEW, OLD_RESERVE_ADDRESS, NEW_RESERVE_ADDRESS } =
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
        creator: 'in.(BlockApps,mercata_usdst)',
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

    // Get second user token
    const tokenString2 = await getUserToken(USERNAME_NEW, PASSWORD_NEW);
    if (!tokenString2) {
      throw new Error('Failed to acquire token.');
    }
    console.log('Token acquired:', tokenString2);
    const token2 = { token: tokenString2 };

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
      await updateOldEscrowDataBatch(token2, NEW_RESERVE_ADDRESS, batch);

      // On the new reserve, update the escrow borrow data.
      await updateOldEscrowBorrowDataBatch(token2, NEW_RESERVE_ADDRESS, batch);
    }

    // On the old reserve, transfer CATA back to owner
    await transferCATAToNewReserve(
      token,
      token2,
      OLD_RESERVE_ADDRESS,
      NEW_RESERVE_ADDRESS
    );

    console.log('Reserve migration and updates completed successfully.');
  } catch (error) {
    console.error('Fatal error during reserve migration:', error);
  }
}

main();
