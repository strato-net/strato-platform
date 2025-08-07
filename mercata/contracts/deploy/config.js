/**
 * Configuration for contract deployment
 */
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Configuration object
const config = {
  // Node configuration
  nodes: [
    {
      url: process.env.NODE_URL,
      oauth: {
        openIdDiscoveryUrl: process.env.OAUTH_URL,
        clientId: process.env.OAUTH_CLIENT_ID,
        clientSecret: process.env.OAUTH_CLIENT_SECRET,
        tokenField: 'access_token'
      }
    }
  ],

  // Contract configuration
  contractsDir: process.env.CONTRACTS_DIR || path.join(__dirname, "../concrete"),
  mainFile: process.env.MAIN_FILE || 'BaseCodeCollection.sol',
  appName: process.env.APP_NAME || 'Mercata',

  // Transaction parameters – can be overridden with env vars
  gasPrice: parseInt(process.env.GAS_PRICE || '10', 10), // in Wei
  gasLimit: parseInt(process.env.GAS_LIMIT || '5000000', 10),

  // Helper function to resolve paths
  resolvePath: (filePath) => path.resolve(process.cwd(), filePath)
};

module.exports = config;