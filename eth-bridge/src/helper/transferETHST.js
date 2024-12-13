// src/services/transactionService.js
const apiClient = require('../helper/apiClient');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Sends a parallel transaction to the marketplace.
 *
 * @param {Object} payload - The transaction payload.
 * @returns {Promise<Object>} - The API response.
 */
const fetchParallelTransaction = async (payload) => {
  try {
    const response = await apiClient.post('/transaction/parallel?resolve=true', payload);
    logger.info('Parallel transaction fetched successfully.');
    return response.data;
  } catch (error) {
    logger.error(`Error in fetchParallelTransaction: ${error.message}`);
    throw new Error('Failed to execute parallel transaction.');
  }
};

/**
 * Creates a mintETHST transaction object.
 *
 * @param {string} contractAddress - The contract address.
 * @param {string} toAddress - The recipient address.
 * @param {string} value - The amount to mint.
 * @param {string} txHash - The transaction hash.
 * @returns {Object} - The transaction object.
 */
const mintETHST = (contractAddress, toAddress, value, txHash) => ({
  payload: {
    contractName: config.contractName,
    contractAddress,
    method: 'mintETHST',
    args: {
      _userAddress: toAddress,
      _amount: value,
      _txHash: txHash,
    },
  },
  type: 'FUNCTION',
});

/**
 * Creates and sends a transaction payload.
 *
 * @param {Object} transaction - The transaction details.
 * @param {Array<Object>} stratsAssetAddressesToUse - Array of strategy asset addresses.
 * @returns {Promise<Object>} - The API response.
 */
const createTransactionPayload = async (transaction, stratsAssetAddressesToUse) => {
  try {
    if (!stratsAssetAddressesToUse || !Array.isArray(stratsAssetAddressesToUse)) {
      throw new Error('Invalid stratsAssetAddressesToUse provided.');
    }

    const txObjects = stratsAssetAddressesToUse.map((strategy) =>
      mintETHST(strategy.address, transaction.toAddress, strategy.quantity, transaction.txHash)
    );

    const payload = {
      txs: txObjects,
      txParams: {
        gasLimit: '32100000000', // Ensure this is a string or number as required by the API
        gasPrice: '1', // Ensure this is a string or number as required by the API
      },
    };

    const response = await fetchParallelTransaction(payload);
    logger.info('Transaction payload created and sent successfully.');
    return response;
  } catch (error) {
    logger.error(`Error in createTransactionPayload: ${error.message}`);
    throw new Error('Failed to create transaction payload.');
  }
};

module.exports = {
  createTransactionPayload,
};