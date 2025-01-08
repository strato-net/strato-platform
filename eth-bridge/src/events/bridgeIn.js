const { dbApiClient } = require("../helper/apiClient");
const { mintAndTransfer } = require("../config");
const { createTransactionPayload } = require("../helper/transaction");

const INITIAL_SLEEP_INTERVAL = 500;
const SLEEP_INCREMENT = 10;
const DEFAULT_TIMEOUT = 120000;

/**
 * Pauses execution for the specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 * @returns {Promise<void>} A promise that resolves after the specified time.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits until a condition is met or the timeout is reached.
 * @param {string} hash - The transaction hash to query.
 * @param {number} timeout - The maximum time (ms) to wait.
 */
async function until(hash, timeout = DEFAULT_TIMEOUT) {
  let sleepInterval = INITIAL_SLEEP_INTERVAL;
  let totalSleep = 0;

  while (totalSleep < timeout) {
    try {
      const result = await dbApiClient.get(
        `/BlockApps-Mercata-MercataETHBridge-ETHBridgeHashAdded`,
        { params: { txhash: `eq.${encodeURIComponent(hash)}` } }
      );

      if (result?.data?.length > 0) {
        console.log("Condition met within timeout.");
        return result.data;
      }
    } catch (error) {
      console.warn("Error during API call. Retrying...", error.message);
    }

    await sleep(sleepInterval);
    totalSleep += sleepInterval;
    sleepInterval += SLEEP_INCREMENT;
  }

  throw new Error(`until: timeout of ${timeout} ms exceeded`);
}

/**
 * Handles the BridgeIn event by processing the transaction and interacting with the API.
 * @param {Object} transaction - The transaction object containing `hash` and `value`.
 * @param {number} timeout - The maximum time (ms) to wait for the condition.
 */
async function handleBridgeIn(transaction, timeout = DEFAULT_TIMEOUT) {
  const { hash, value } = transaction;

  try {
    console.log("Processing BridgeIn transaction:", { hash, value });

    // Wait until the condition is met or the timeout is reached
    const queryBody = await until(hash, timeout);

    if (!queryBody || queryBody.length === 0 || !queryBody[0].userAddress) {
      throw new Error("Invalid data received from the `until` function");
    }

    const receiverAddress = queryBody[0].userAddress;
    const standardValue = BigInt(value).toString();

    // Create transaction payload
    const response = await createTransactionPayload(
      receiverAddress,
      standardValue,
      hash,
      mintAndTransfer
    );

    // Handle response
    if (response.status !== 200) {
      console.error("Transaction creation failed:", response.status, response.data);
      throw new Error(
        `Transaction creation failed with status ${response.status}: ${response.statusText}`
      );
    }

    console.log("Transaction successfully created:", response.data);
  } catch (error) {
    console.error("Error handling BridgeIn event:", error.message);
    console.error(error.stack);
  }
}

module.exports = { handleBridgeIn };