const config = require('./config');
const { rest, util } = require('blockapps-rest');
const auth = require('./auth');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const CREATE_ISSUE_POLL_INTERVAL_MS = parseInt(process.env.CREATE_ISSUE_POLL_INTERVAL_MS || '10000', 10);
const CREATE_ISSUE_LOOKUP_TIMEOUT_MS = parseInt(process.env.CREATE_ISSUE_LOOKUP_TIMEOUT_MS || '3600000', 10);
const CREATE_ISSUE_TIMEOUT_MS = parseInt(process.env.CREATE_ISSUE_TIMEOUT_MS || '3600000', 10);

const getTokenFromNameAndPassword = async () => {
    const GLOBAL_ADMIN_NAME = getEnvVar('GLOBAL_ADMIN_NAME');
    const GLOBAL_ADMIN_PASSWORD = getEnvVar('GLOBAL_ADMIN_PASSWORD');
    
    // Validate environment variables
    if (!GLOBAL_ADMIN_NAME || !GLOBAL_ADMIN_PASSWORD) {
            throw new Error(
              'GLOBAL_ADMIN_NAME and GLOBAL_ADMIN_PASSWORD environment variables are required.'
            );
          }

    const tokenString = await auth.getUserToken(GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD);

    if (!tokenString) {
        throw new Error('Failed to acquire token.');
    }

    return tokenString;
}

/**
 * Calls a list of function calls and polls until all transactions have completed.
 *
 * @param {Object} token - The token object.
 * @param {Array} callListArgs - Array of call arguments.
 * @returns {Promise<Array>} - Final transaction results.
 */
const callListAndWait = async (callListArgs) => {
    const tokenString = await getTokenFromNameAndPassword();

    if (!tokenString) {
        throw new Error('Failed to acquire token.');
    }
    console.log('Token acquired:', tokenString.slice(0, 10), '...');//printing the first 10 characters of the token 
    const token = { token: tokenString };


    const options = { config, cacheNonce: true, isAsync: true };
    const pendingTxResultList = await rest.callList(token, callListArgs, options);
    const responseArray = Array.isArray(pendingTxResultList)
      ? pendingTxResultList
      : [pendingTxResultList];
  
    // Poll until there are no pending transactions.
    const predicate = (results) =>
      results.filter((r) => r.status === 'Pending').length === 0;
    const action = async (options) =>
      await rest.getBlocResults(
        token,
        responseArray.map((r) => r.hash),
        options
      );
    const finalResults = await util.until(
      predicate,
      action,
      { config, isAsync: true },
      3600000
    );

    
    return finalResults;
  };

const createContractArgs = async (contractArgs) => {
    const tokenString = await getTokenFromNameAndPassword();

    if (!tokenString) {
        throw new Error('Failed to acquire token.');
    }
      console.log('Token acquired:', tokenString.slice(0, 10), '...');
    const token = { token: tokenString };

    // Deployment options.
    const options = {
        config,
        history: contractArgs.name,
        cacheNonce: true,
        isAsync: true,
      };
      console.log(
        'Deploying new ' + contractArgs.name + ' contract via rest.createContract...'
      );
      const response = await rest.createContract(token, contractArgs, options);
  
      // Ensure response is an array so that we can safely call .map()
      const responseArray = Array.isArray(response) ? response : [response];
  
      // 5. Poll until the new contract appears in the database.
      const predicate = (results) =>
        results.filter((r) => r.status === 'Pending').length === 0;
      const action = async (options) =>
        rest.getBlocResults(
          token,
          responseArray.map((r) => r.hash),
          options
        );
      const finalResults = await util.until(
        predicate,
        action,
        { config, isAsync: true },
        3600000
      );
      
      const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
      if (final.status !== 'Success') {
        throw new Error(`Error: contract deployment failed.`);
      }
      return final;
};

/**
 * Saves the deployment information to a text file.
 * @param {string} contractName - The name of the contract.
 * @param {Object} final - The final transaction result.
 */
const saveCreateTXDataAsFile = async (contractName, final) => {

    // Store deployment information in a text file
    const deploymentInfo = {
        contractName: contractName,
        deploymentTime: new Date().toISOString(),
        contractAddress: final.txResult.contractsCreated,
        transactionHash: final.hash,
        status: final.status
      };
      
      const deploymentDir = path.join(__dirname, 'deployment-logs');
      if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
      }
      
      const filename = `${contractName}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      const filePath = path.join(deploymentDir, filename);
      
      const content = JSON.stringify(deploymentInfo, null, 2);
      fs.writeFileSync(filePath, content);
      
      console.log(`Deployment information saved to: ${filePath}`);

}

const saveCallListTXDataAsFile = async (callInfo) => {

    const deploymentDir = path.join(__dirname, 'deployment-logs');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }
    
    const filename = `${callInfo.operation}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const filePath = path.join(deploymentDir, filename);
    
    const content = JSON.stringify(callInfo, null, 2);
    fs.writeFileSync(filePath, content);
    
    console.log(`Deployment information saved to: ${filePath}`);

}

/**
 * Obtains an environment variable.
 * Throws an error if the variable is not set.
 * @param {string} name - The environment variable name.
 * @returns {string} - The environment variable value.
 */
function getEnvVar(name) {
  const value = process.env[name];
  if (value === undefined || value === null) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

const firstValue = (value) => Array.isArray(value) ? value[0] : value;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getReceiptValue(receipt) {
  return receipt?.txResult?.response?.v || firstValue(receipt?.data?.contents) || null;
}

function getCreatedAddress(receipt) {
  const created = firstValue(receipt?.txResult?.contractsCreated);
  if (typeof created === 'string' && created.length > 0) return created;

  const value = getReceiptValue(receipt);
  return typeof value === 'string' && ADDRESS_RE.test(value) ? value : null;
}

function getIssueId(receipt) {
  const value = getReceiptValue(receipt);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function searchCirrusWithToken(tokenObj, tableName, params) {
  const response = await axios.get(`${config.nodes[0].url}/cirrus/search/${tableName}`, {
    headers: { Authorization: `Bearer ${tokenObj.token}` },
    params,
  });
  return response.data;
}

function getEventTxHash(event = {}) {
  return event.transaction_hash || event.transactionHash || event.txHash || event.hash;
}

function getEventTimestamp(event = {}) {
  return event.block_timestamp || event.blockTimestamp || event.timestamp;
}

async function waitForCirrusRow(tokenObj, tableName, params, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await searchCirrusWithToken(tokenObj, tableName, params);
    const match = Array.isArray(rows) ? rows.find(predicate) : null;
    if (match) return match;
    await sleep(CREATE_ISSUE_POLL_INTERVAL_MS);
  }
  return null;
}

async function getIssueCreatedTimestamp(tokenObj, issueId, creationTxHash, fallbackTimestamp) {
  const row = creationTxHash && await waitForCirrusRow(
    tokenObj,
    'BlockApps-AdminRegistry-IssueCreated',
    { issueId: `eq.${issueId}`, order: 'block_timestamp.desc', limit: '10' },
    (event) => getEventTxHash(event) === creationTxHash && getEventTimestamp(event),
    CREATE_ISSUE_LOOKUP_TIMEOUT_MS
  );

  const timestamp = getEventTimestamp(row);
  if (timestamp) return timestamp;

  console.log(`IssueCreated timestamp was not found for tx ${creationTxHash}; falling back to local submit time ${fallbackTimestamp}`);
  return fallbackTimestamp;
}

async function pollForCreateIssueExecution(tokenObj, issueId, creationReceipt, fallbackTimestamp, addressLabel = 'contract address') {
  const tableName = 'BlockApps-AdminRegistry-IssueExecuted';
  const creationTxHash = creationReceipt && creationReceipt.hash;
  const createdAfter = await getIssueCreatedTimestamp(tokenObj, issueId, creationTxHash, fallbackTimestamp);

  console.log(`Create-contract governance issue created: ${issueId}`);
  console.log(`Waiting for IssueExecuted event in ${tableName} after ${createdAfter}...`);

  const executed = await waitForCirrusRow(
    tokenObj,
    tableName,
    { issueId: `eq.${issueId}`, block_timestamp: `gte.${createdAfter}`, order: 'block_timestamp.desc', limit: '10' },
    () => true,
    CREATE_ISSUE_TIMEOUT_MS
  );

  if (!executed) {
    throw new Error(`Timed out waiting for create-contract issue to execute: ${issueId}`);
  }

  const txHash = getEventTxHash(executed);
  if (!txHash) {
    throw new Error('IssueExecuted found but no transaction hash was available: ' + JSON.stringify(executed));
  }

  const finalResults = await rest.getBlocResults(tokenObj, [txHash], { config, isAsync: true });
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  const address = getCreatedAddress(final);
  if (address) return address;

  throw new Error(
    `Create-contract issue executed but no ${addressLabel} was found in receipt: ` +
      JSON.stringify(final)
  );
}

/**
 * Performs a Cirrus search query using username/password authentication.
 * 
 * @param {string} tableName - The Cirrus table name to query (e.g., 'BlockApps-Pool')
 * @param {Object} params - Query parameters for the Cirrus search
 * @returns {Promise<Array>} - The search results
 */
const cirrusSearch = async (tableName, params = {}) => {
  const tokenString = await getTokenFromNameAndPassword();
  
  if (!tokenString) {
    throw new Error('Failed to acquire token for Cirrus search.');
  }

  // Get the base URL from config
  const baseUrl = config.nodes[0].url;
  const cirrusUrl = `${baseUrl}/cirrus/search/${tableName}`;
  console.log('Cirrus URL:', cirrusUrl);
  const headers = { 
    Authorization: `Bearer ${tokenString}`, 
    "Content-Type": "application/json" 
  };

  try {
    const { data } = await axios.get(cirrusUrl, { headers, params });
    return data;
  } catch (error) {
    console.error('Cirrus search failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`Cirrus search failed: ${error.message}`);
  }
};

module.exports = {
  callListAndWait,
  createContractArgs,
  getEnvVar,
  saveCreateTXDataAsFile,
  saveCallListTXDataAsFile,
  cirrusSearch,
  getCreatedAddress,
  getIssueId,
  pollForCreateIssueExecution,
};