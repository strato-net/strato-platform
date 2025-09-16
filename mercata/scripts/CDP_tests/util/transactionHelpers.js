// Transaction Helper Functions
// Reusable functions for building and executing transactions

const axios = require("axios");

/**
 * Build a transaction call object
 * @param {string} contractName - Name of the contract
 * @param {string} contractAddress - Address of the contract
 * @param {string} method - Method name to call
 * @param {Object} args - Arguments for the method call
 * @returns {Object} Transaction call object
 */
function buildCall(contractName, contractAddress, method, args = {}) {
  return {
    type: "FUNCTION",
    payload: {
      contractName,
      contractAddress,
      method,
      args
    }
  };
}

/**
 * Create headers for different account types
 * @param {Object} tokens - Object containing token mappings
 * @returns {Object} Headers object for each account type
 */
function createHeaders(tokens) {
  const headers = {};
  
  if (tokens.ADMIN_TOKEN) {
    headers.admin = { Authorization: `Bearer ${tokens.ADMIN_TOKEN}`, "Content-Type": "application/json" };
  }
  
  if (tokens.ACC1_TOKEN) {
    headers.acc1 = { Authorization: `Bearer ${tokens.ACC1_TOKEN}`, "Content-Type": "application/json" };
  }
  
  if (tokens.ACC2_TOKEN) {
    headers.acc2 = { Authorization: `Bearer ${tokens.ACC2_TOKEN}`, "Content-Type": "application/json" };
  }
  
  if (tokens.ACC3_TOKEN) {
    headers.acc3 = { Authorization: `Bearer ${tokens.ACC3_TOKEN}`, "Content-Type": "application/json" };
  }
  
  return headers;
}

/**
 * Extract error message from 422 responses
 * @param {Error} error - The error object from axios
 * @returns {string} Extracted error message
 */
function extractErrorMessage(error) {
  if (error.response && error.response.status === 422 && error.response.data) {
    const errorData = error.response.data;
    if (typeof errorData === 'string') {
      // Try to extract Solidity error: "Error running the transaction: solidity require failed: SString \"<message>\""
      const solidityMatch = errorData.match(/solidity require failed: SString "([^"]+)"/);
      if (solidityMatch) {
        return solidityMatch[1];
      }
      
      // Try to extract other error patterns: "Error running the transaction: <message>"
      const generalMatch = errorData.match(/Error running the transaction: (.+)/);
      if (generalMatch) {
        return generalMatch[1];
      }
      
      // Return the full error data if no pattern matches
      return errorData;
    }
  }
  return error.message;
}

/**
 * Execute transaction with retry logic
 * @param {Function} txFunction - Function that executes the transaction
 * @param {string} description - Description of the transaction for logging
 * @param {number} maxRetries - Maximum number of retries (default: 2)
 * @param {number} retryDelay - Delay between retries in ms (default: 5000)
 * @returns {Promise} Result of the transaction
 */
async function executeWithRetry(txFunction, description = "transaction", maxRetries = 2, retryDelay = 5000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await txFunction();
    } catch (error) {
      lastError = error;
      
      // Check if it's a retryable error (mempool issues, network congestion, etc.)
      const errorMsg = extractErrorMessage(error);
      const isRetryable = errorMsg.includes('mempool') || 
                         errorMsg.includes('nonce') || 
                         errorMsg.includes('lucrative') ||
                         errorMsg.includes('pending') ||
                         (error.response && error.response.status >= 500);
      
      if (attempt < maxRetries && isRetryable) {
        console.warn(`⚠️  ${description} failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
        console.log(`🔄 Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        // Don't retry on final attempt or non-retryable errors
        throw error;
      }
    }
  }
  
  // This shouldn't be reached, but just in case
  throw lastError;
}

/**
 * Execute a single transaction
 * @param {string} txEndpoint - Transaction endpoint URL
 * @param {Object} tx - Transaction object
 * @param {Object} headers - Request headers
 * @param {string} description - Description for logging
 * @returns {Promise<Object>} Transaction result
 */
async function executeTransaction(txEndpoint, tx, headers, description = "transaction") {
  try {
    const { data: result } = await axios.post(txEndpoint, { txs: [tx] }, { headers });
    
    if (result[0].status !== "Success") {
      throw new Error(`${description} failed: ${result[0].error || result[0].status}`);
    }
    
    return result[0];
  } catch (error) {
    console.error(`❌ ${description} failed:`, extractErrorMessage(error));
    throw error;
  }
}

/**
 * Execute multiple transactions in parallel
 * @param {string} txEndpoint - Transaction endpoint URL
 * @param {Array} txs - Array of transaction objects
 * @param {Object} headers - Request headers
 * @param {string} description - Description for logging
 * @returns {Promise<Array>} Transaction results
 */
async function executeTransactionsBatch(txEndpoint, txs, headers, description = "batch transaction") {
  try {
    const { data: results } = await axios.post(txEndpoint, { txs }, { headers });
    
    // Check if any transaction failed
    const failed = results.find(r => r.status !== "Success");
    if (failed) {
      throw new Error(`${description} failed: ${failed.error || failed.status}`);
    }
    
    return results;
  } catch (error) {
    console.error(`❌ ${description} failed:`, extractErrorMessage(error));
    throw error;
  }
}

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate required environment variables
 * @param {Object} required - Object with required env var names and error messages
 * @throws {Error} If any required env vars are missing
 */
function validateEnvironment(required) {
  for (const [envVar, errorMessage] of Object.entries(required)) {
    if (!process.env[envVar]) {
      throw new Error(errorMessage || `${envVar} environment variable required`);
    }
  }
}

/**
 * Setup API configuration from environment
 * @returns {Object} API configuration object
 */
function setupApiConfig() {
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;
  const txEndpoint = `${BASE}/transaction/parallel?resolve=true`;
  
  return { ROOT, BASE, txEndpoint };
}

module.exports = {
  buildCall,
  createHeaders,
  extractErrorMessage,
  executeWithRetry,
  executeTransaction,
  executeTransactionsBatch,
  sleep,
  validateEnvironment,
  setupApiConfig
};
