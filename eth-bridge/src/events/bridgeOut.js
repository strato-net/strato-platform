const { Alchemy, Network, Wallet, Contract } = require("alchemy-sdk");
const {
  alchemyApiKey,
  alchemyNetwork,
  blockAppsPrivateKey,
} = require("../config");
const { dbApiClient } = require("../helper/apiClient");

// Configure Alchemy SDK and Wallet
const alchemy = new Alchemy({
  apiKey: alchemyApiKey,
  network: Network[alchemyNetwork],
});
const signer = new Wallet(blockAppsPrivateKey, alchemy);

/**
 * Retrieves the deployed contract address based on the provided Mercata contract address.
 * Returns an object with a success flag and the contractAddress (if found).
 * @param {string} mercataContractAddress - The address from the event.
 * @returns {Promise<{ success: boolean, contractAddress: string|null, error?: Error }>}
 */
async function getContractAddress(mercataContractAddress) {
  try {
    const response = await dbApiClient.get(
      `/BlockApps-Mercata-MercataETHBridge-ETHBridgeHashAdded`,
      {
        params: { address: `eq.${encodeURIComponent(mercataContractAddress)}` },
      }
    );

    if (!response?.data?.length) {
      console.warn(`No transaction hash found for ${mercataContractAddress}`);
      return { success: true, contractAddress: null };
    }

    const txHash = response.data[0].txhash;

    // Retrieve the transaction details
    const tx = await alchemy.core.getTransaction(txHash);

    // Use the value field to determine transfer type.
    // For native ETH transfers, tx.value is non-zero.
    // For ERC20 token transfers, tx.value is typically zero.
    if (tx.value && !tx.value.isZero()) {
      return { success: true, contractAddress: null };
    } else {
      return { success: true, contractAddress: tx.to };
    }
  } catch (error) {
    console.warn("Error in getContractAddress:", error.message);
    return { success: false, error };
  }
}

/**
 * Sends a native ETH transfer.
 * @param {string} to - Recipient address.
 * @param {bigint} amount - Amount in wei.
 * @returns {Promise<Object>} Transaction receipt.
 */
async function sendEthTransfer(to, amount) {
  console.log(`Sending ETH transfer to ${to} with amount ${amount.toString()}`);
  const tx = await signer.sendTransaction({ to, value: amount.toString() });
  console.log("ETH transaction sent. Waiting for confirmation...");
  return await tx.wait();
}

/**
 * Sends an ERC20 token transfer via the token's contract.
 * @param {string} tokenContractAddress - Address of the ERC20 token contract.
 * @param {string} to - Recipient address.
 * @param {bigint} amount - Amount in token's smallest unit.
 * @returns {Promise<Object>} Transaction receipt.
 */
async function sendERC20Transfer(tokenContractAddress, to, amount) {
  console.log(
    `Sending ERC20 token transfer via contract ${tokenContractAddress} to ${to} with amount ${amount.toString()}`
  );
  const erc20Abi = [
    "function transfer(address to, uint256 amount) external returns (bool)",
  ];

  const tokenContract = new Contract(tokenContractAddress, erc20Abi, signer);

  // Function to transfer tokens
  const tx = await tokenContract.transfer(to, amount);
  return await tx.wait(); // Wait for transaction confirmation
}

/**
 * Processes the BridgeOut event by determining the transfer type (ETH vs ERC20) and executing the transfer.
 * It uses getContractAddress to decide: if a contract address is returned, it's an ERC20 transfer; otherwise, ETH.
 * @param {Object} event - Event object containing transaction details.
 * @returns {Promise<Object>} Transaction receipt.
 */
async function handleBridgeOut(event) {
  try {
    const eventEvent = event?.eventEvent;
    const eventArgs = eventEvent?.eventArgs || [];
    const mercataContractAddress = eventEvent?.eventContractAddress;
    const to = eventArgs.find((arg) => arg[0] === "baseAddress")?.[1];
    const value = eventArgs.find((arg) => arg[0] === "amount")?.[1];

    if (!to || !value || !mercataContractAddress) {
      throw new Error(
        "Missing required event arguments: baseAddress, amount, or mercataContractAddress."
      );
    }

    const amount = BigInt(value);
    const {
      success,
      contractAddress: tokenContractAddress,
      error,
    } = await getContractAddress(mercataContractAddress);

    if (!success) {
      throw new Error(`getContractAddress failed: ${error.message}`);
    }

    if (tokenContractAddress) {
      console.log("Detected ERC20 token transfer.");
      const receipt = await sendERC20Transfer(tokenContractAddress, to, amount);
      console.log("ERC20 transfer confirmed:", {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
      });
      return receipt;
    } else {
      console.log("Detected ETH transfer.");
      const receipt = await sendEthTransfer(to, amount);
      console.log("ETH transfer confirmed:", {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
      });
      return receipt;
    }
  } catch (error) {
    console.error("Error handling BridgeOut event:", error.message);
    console.error(error.stack);
    throw error;
  }
}

module.exports = { handleBridgeOut };
