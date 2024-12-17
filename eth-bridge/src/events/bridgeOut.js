const { Alchemy, Network, Wallet } = require("alchemy-sdk");
const {
  alchemyApiKey,
  alchemyNetwork,
  blockAppsPrivateKey,
} = require("../config");

// Alchemy SDK Configuration
const alchemy = new Alchemy({
  apiKey: alchemyApiKey,
  network: Network[alchemyNetwork],
});

// Wallet Configuration
const signer = new Wallet(blockAppsPrivateKey, alchemy);

/**
 * Handles the BridgeOut event by processing the transaction and interacting with the blockchain.
 * @param {Object} event - The event object containing details about the BridgeOut transaction.
 */
async function handleBridgeOut(event) {
  try {
    // Extract `to` and `value` fields from event arguments
    const to = event?.eventEvent?.eventArgs?.find(
      (arg) => arg[0] === "baseAddress"
    )?.[1];
    const value = event?.eventEvent?.eventArgs?.find(
      (arg) => arg[0] === "amount"
    )?.[1];

    // Validate extracted data
    if (!to || !value) {
      throw new Error("Invalid event arguments: Missing `to` or `value`");
    }

    // Log transaction details for traceability
    console.log("Processing BridgeOut transaction:", { to, value });

    // Create and send the transaction
    const valueAsString = BigInt(value);
    console.log("Sending transaction to", to, "with value", valueAsString);
    const transactionObject = {
      to,
      value: valueAsString.toString(),
    };

    const tx = await signer.sendTransaction(transactionObject);

    console.log("Transaction sent. Waiting for confirmation...");

    // Wait for the transaction to be mined
    const receipt = await tx.wait();

    console.log("Transaction successfully created:", {
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    });

    return receipt; // Optionally return the transaction receipt
  } catch (error) {
    console.error("Error handling BridgeOut event:", error.message);
    console.error(error.stack);
  }
}

module.exports = { handleBridgeOut };
