const { dbApiClient } = require("../helper/apiClient");
const { mintAndTransfer } = require("../config");
const { createTransactionPayload } = require("../helper/transaction");

/**
 * Handles the BridgeIn event by processing the transaction and interacting with the API.
 * @param {Object} transaction - The transaction object containing `hash` and `value`.
 */
async function handleBridgeIn(transaction) {
  const { hash, value } = transaction;

  try {
    // Log the incoming transaction for better traceability
    console.log("Processing BridgeIn transaction:", { hash, value });

    // Fetch certificates based on the transaction hash
    const queryResponse = await dbApiClient.get(
      `/BlockApps-Mercata-Asset-ETHBridgeHashAdded`,
      {
        params: { txhash: `eq.${encodeURIComponent(hash)}` },
      }
    );

    const queryBody = queryResponse.data;

    // Handle case where no data is returned
    if (!queryBody || queryBody.length === 0) {
      console.warn(
        `No Bridge In events found for hash: ${hash} on the Mercata network.`
      );
      return;
    }

    console.log("Certificates retrieved successfully:", queryBody);

    // Create transaction payload
    // Convert the hex value to a standard number as a string
    const standardValue = BigInt(value).toString();
    const recieverAddress = queryBody[0].userAddress;
    const response = await createTransactionPayload(
      recieverAddress,
      standardValue,
      hash,
      mintAndTransfer
    );

    // Handle response from the transaction payload creation
    if (response.status !== 200) {
      console.error(
        `Transaction creation failed with status: ${response.status}`
      );
      console.error("Response body:", response.data);
      throw new Error(
        `Transaction creation failed with status ${response.status}: ${response.statusText}`
      );
    }

    console.log("Transaction successfully created:", response.data);
  } catch (error) {
    console.error("Error handling BridgeIn event:", error.message);

    // Optionally log the stack trace for debugging purposes
    console.error(error.stack);
  }
}

module.exports = { handleBridgeIn };
