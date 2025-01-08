const { networkApiClient, dbApiClient } = require("./apiClient");
const logger = require("./logger");

/**
 * Sends a parallel transaction to the marketplace.
 *
 * @param {Object} payload - The transaction payload.
 * @returns {Promise<Object>} - The API response data.
 */
const fetchParallelTransaction = async (payload) => {
  try {
    const response = await networkApiClient.post(
      "/transaction/parallel?resolve=true",
      payload
    );
    logger.info("Parallel transaction executed successfully.");
    return response;
  } catch (error) {
    logger.error(`Error in fetchParallelTransaction: ${error.message}`);
    throw new Error("Failed to execute parallel transaction.");
  }
};

/**
 * Creates a transaction object dynamically based on the provided method.
 *
 * @param {string} method - The contract method to call.
 * @param {string} toAddress - The recipient address.
 * @param {string} value - The amount to transfer.
 * @param {string} txHash - The transaction hash.
 * @returns {Object} - The transaction object.
 */
const createTransactionObject = async (method, toAddress, value, txHash) => {
  if (!method || !toAddress || !value || !txHash) {
    throw new Error("Invalid transaction parameters.");
  }

  // Fetch certificates based on the transaction hash
  const queryResponse = await dbApiClient.get(
    `/BlockApps-Mercata-MercataETHBridge`,
    {
      params: { isActive: `eq.true`, creator: `eq.BlockApps`, ['data->>isMint']: `eq.True` },
    }
  );
  console.log("queryResponse", queryResponse);

  const queryBody = queryResponse.data;

  // Handle case where no data is returned
  if (!queryBody || queryBody.length === 0) {
    console.warn(`No MercataETHBridge contracts found on the Mercata network.`);
    return;
  }

  console.log("MercataETHBridge retrieved successfully:", queryBody);

  return {
    payload: {
      contractName: "MercataETHBridge",
      contractAddress: queryBody[0].address,
      method,
      args: {
        _userAddress: toAddress,
        _amount: value,
        _txHash: txHash,
      },
    },
    type: "FUNCTION",
  };
};

/**
 * Creates and sends a transaction payload.
 *
 * @param {string} receiverAddress - The recipient address.
 * @param {string} value - The amount to transfer.
 * @param {string} txHash - The transaction hash.
 * @param {string} method - The contract method to call.
 * @returns {Promise<Object>} - The API response data.
 */
const createTransactionPayload = async (
  receiverAddress,
  value,
  txHash,
  method
) => {
  try {
    if (!receiverAddress || !value || !txHash || !method) {
      throw new Error("Invalid transaction details.");
    }

    // Create transaction payload dynamically
    const payload = {
      txs: [
        await createTransactionObject(method, receiverAddress, value, txHash),
      ],
      txParams: {
        gasLimit: 32100000000,
        gasPrice: 1,
      },
    };

    // Send transaction
    const response = await fetchParallelTransaction(payload);
    logger.info(
      `Transaction payload created and sent successfully with method: ${method}`
    );
    return response;
  } catch (error) {
    logger.error(`Error in createTransactionPayload: ${error.message}`);
    throw new Error(
      `Failed to create and send transaction payload with method: ${method}`
    );
  }
};

module.exports = {
  createTransactionPayload,
};
