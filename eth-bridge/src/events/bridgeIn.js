const { dbApiClient } = require("../helper/apiClient");
const { mintAndTransfer } = require("../config");
const { createTransactionPayload } = require("../helper/transaction");

const INITIAL_SLEEP_INTERVAL = 500;
const SLEEP_INCREMENT = 10;
const DEFAULT_TIMEOUT = 120000;
const ERC20_TRANSFER_SIGNATURE = "0xa9059cbb"; // Function selector for transfer(address,uint256)
const MAINNET_WBTC_CONTRACT_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599".toLowerCase(); // Mainnet WBTC contract address
const TESTNET_WBTC_CONTRACT_ADDRESS = "0x577D296678535e4903D59A4C929B718e1D575e0A".toLowerCase(); // Testnet WBTC contract address

/**
 * Decodes the ERC-20 transfer data from the input.
 * @param {string} input - The hex-encoded input data of the transaction.
 * @returns {Object|null} - Parsed transfer details or null if not an ERC-20 transfer.
 */
const parseERC20Transfer = (input) => {
  if (!input.startsWith(ERC20_TRANSFER_SIGNATURE)) return null;

  const iface = new ethers.utils.Interface([
    "function transfer(address to, uint256 value)",
  ]);

  try {
    const decoded = iface.decodeFunctionData("transfer", input);
    // Confirm the WBTC contract address
    if (from.toLowerCase() === MAINNET_WBTC_CONTRACT_ADDRESS || from.toLowerCase() === TESTNET_WBTC_CONTRACT_ADDRESS) {
      return {
        to: decoded.to,
        value: BigInt(decoded.value).toString(),
        token: "WBTC",
      };
    }
  } catch (error) {
    console.error("Error parsing ERC-20 transfer input:", error.message);
    return null;
  }
};

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

    let tokenType = "ETH";
    let transferValue = BigInt(value).toString(); // Default: ETH value

    if (BigInt(value) === 0n && input) {
      // Check for ERC-20 token transfer via input data
      const erc20Transfer = parseERC20Transfer(input);
      if (erc20Transfer && erc20Transfer.to.toLowerCase() === to.toLowerCase()) {
        tokenType = erc20Transfer.token; // We assume this is WBTC if valid ERC-20 `transfer` input
        transferValue = erc20Transfer.value; // ERC-20 transfer value
      } else {
        console.error("Transaction doesn't match expected token transfer");
        return; // Skip unsupported transactions
      }
    }

    console.log(`Detected ${tokenType} transfer:`, { to, transferValue });

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