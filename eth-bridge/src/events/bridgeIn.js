const { dbApiClient } = require("../helper/apiClient");
const { mintAndTransfer, blockAppsPublicKey } = require("../config");
const { createTransactionPayload } = require("../helper/transaction");
const { ethers } = require("ethers");

const INITIAL_SLEEP_INTERVAL = 500;
const SLEEP_INCREMENT = 10;
const DEFAULT_TIMEOUT = 120000;

/**
 * Decodes the ERC-20 transfer data from the input.
 * @param {string} input - The hex-encoded input data of the transaction.
 * @returns {Object|null} - Parsed transfer details or null if not an ERC-20 transfer.
 */
const parseERC20TransferLog = (log) => {
  const { topics, data, address } = log;

  if (topics[0] !== ethers.id("Transfer(address,address,uint256)")) {
    console.error("Not a valid ERC-20 Transfer event.");
    return null;
  }

  // Decode the "from" and "to" addresses
  const from = ethers.getAddress(`0x${topics[1].slice(26)}`);
  const to = ethers.getAddress(`0x${topics[2].slice(26)}`);
  const value = BigInt(data).toString(); // Decode the transfer amount

  return { address, from, to, value };
};

/**
 * Pauses execution for the specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 * @returns {Promise<void>} A promise that resolves after the specified time.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

    let tokenType = "ETH";
    let tokenAddress = "";
    let transferValue = BigInt(value).toString(); // Default: ETH value

    if (BigInt(value) === 0n && transaction.tx) {
      // Check for ERC-20 token transfer via input data
      const erc20Transfer = parseERC20TransferLog(transaction.tx);
      if (
        erc20Transfer &&
        erc20Transfer.to.toLowerCase() === blockAppsPublicKey.toLowerCase()
      ) {
        tokenType = "ERC20: ";
        tokenAddress = erc20Transfer.address;
        transferValue = erc20Transfer.value;
      } else {
        console.error("Transaction doesn't match expected token transfer");
        return;
      }
    }

    console.log(`Detected ${tokenType}${tokenAddress} transfer:`, {
      blockAppsPublicKey,
      transferValue,
    });

    // Wait until the condition is met or the timeout is reached
    const queryBody = await until(hash, timeout);

    if (!queryBody || queryBody.length === 0 || !queryBody[0].userAddress) {
      throw new Error("Invalid data received from the `until` function");
    }

    const receiverAddress = queryBody[0].userAddress;

    // Create transaction payload
    const response = await createTransactionPayload(
      receiverAddress,
      transferValue,
      hash,
      mintAndTransfer,
      queryBody[0].address
    );

    // Handle response
    if (response.status !== 200) {
      console.error(
        "Transaction creation failed:",
        response.status,
        response.data
      );
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
