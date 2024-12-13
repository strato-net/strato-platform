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
    // Get transaction receipt
    const receiptResponse = await axios.post(
      `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash]
      }
    );

    if (!receiptResponse.data.result) {
      return false;
    }

    // Check if transaction was successful
    if (receiptResponse.data.result.status !== "0x1") {
      return false;
    }

    // Get current block number
    const blockNumberResponse = await axios.post(
      `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_blockNumber",
        params: []
      }
    );

    const currentBlock = parseInt(blockNumberResponse.data.result, 16);
    const txBlock = parseInt(receiptResponse.data.result.blockNumber, 16);
    const confirmations = currentBlock - txBlock;

    // Require 12 block confirmations
    const REQUIRED_CONFIRMATIONS = 12;
    return confirmations >= REQUIRED_CONFIRMATIONS;

  } catch (error) {
    console.error("Error verifying transaction with Alchemy:", error);
    return false;
  }
}

async function handleETHBridgeHashAdded(event, token) {
  const baseUrl = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;
  const MAX_RETRIES = 20;
  const RETRY_DELAY = 15000; // 15 seconds

  try {
    const txHashEntry = event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "hash"
    );
    const txHash = txHashEntry ? txHashEntry[1] : null;

    if (!txHash) {
      console.error("No transaction hash found in the event.");
      return;
    }

    // Retry verification until enough confirmations
    let isVerified = false;
    let retries = 0;

    while (!isVerified && retries < MAX_RETRIES) {
      isVerified = await verifyEthereumTransaction(txHash);
      if (!isVerified) {
        retries++;
        console.log(`Waiting for confirmations... Attempt ${retries}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }

    if (!isVerified) {
      console.error("Transaction verification failed after maximum retries:", txHash);
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
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
    }
    // You might want to implement some retry mechanism here
    // or notify administrators about the failure
  }
}

module.exports = { handleETHBridgeHashAdded };
