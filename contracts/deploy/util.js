const config = require('./config');
const axios = require('axios');
const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');
const auth = require('./auth');
const path = require('path');
const fs = require('fs');

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
    console.log('Token acquired:', tokenString);
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
    console.log('Token acquired:', tokenString);
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
    if (!value) {
      throw new Error(`Invalid ${name}`);
    }
    return value;
  }

module.exports = { callListAndWait, createContractArgs, getEnvVar, saveCreateTXDataAsFile, saveCallListTXDataAsFile };