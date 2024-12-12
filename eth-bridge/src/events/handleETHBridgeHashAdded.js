const { createTransactionPayload } = require("../helper/transferSTRATS.js");
const {
  NODE_ENV,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
  notificationUrl,
  ALCHEMY_API_KEY
} = require("../config/index.js");
const { getETHSTToBeBridged } = require("../helper/googleSheet.js");
const axios = require("axios");
const { sendEmail, getUserName } = require("../helper/utils.js");

async function verifyEthereumTransaction(txHash) {
  try {
    const response = await axios.post(
      `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash]
      }
    );

    if (response.data.result && response.data.result.status === "0x1") {
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error verifying transaction with Alchemy:", error);
    return false;
  }
}

async function handleETHBridgeHashAdded(event, token) {
  const baseUrl = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;

  try {
    // Get transaction hash from event
    const txHashEntry = event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "hash"
    );
    const txHash = txHashEntry ? txHashEntry[1] : null;

    if (!txHash) {
      console.error("No transaction hash found in the event.");
      return;
    }

    // Verify transaction with Alchemy
    const isVerified = await verifyEthereumTransaction(txHash);
    if (!isVerified) {
      console.error("Transaction verification failed:", txHash);
      return;
    }

    // Get ETHST amount to be bridged
    const getETHSTToBeBridged = await getETHSTToBeBridged(["handleETHBridgeHashAdded"]);
    const amount = getETHSTToBeBridged["handleETHBridgeHashAdded"];
    
    if (!amount || amount <= 0) {
      console.error("Failed to get ETHST amount from Google Sheet");
      return;
    }

    // Get user information from the transaction
    const userAddress = event.eventEvent.sender;
    const userName = await getUserName(baseUrl, userAddress, token);

    // Create transaction payload for minting ETHST
    const transactions = [{
      toAddress: userAddress,
      value: amount,
      txHash: txHash
    }];

    const response = await createTransactionPayload(token, transactions);

    if (response.status !== 200) {
      const errorText = await response.text();
      console.error(`Error: ${response.status} ${response.statusText}`);
      console.error(`Response body: ${errorText}`);
      throw new Error(`Request failed with status ${response.status}: ${response.statusText}`);
    }

    // Send confirmation email
    await sendEmail(
      baseUrl, 
      notificationUrl, 
      'Bridge ETHST', 
      userName, 
      token
    );
    
    console.log("ETHST bridging successful for transaction:", txHash);
  } catch (error) {
    console.error("Error handling ETHBridgeHashAdded event:", error);
  }
}

module.exports = { handleETHBridgeHashAdded };
