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
  contractsDir: process.env.CONTRACTS_DIR || '../BCC',
  mainFile: process.env.MAIN_FILE || 'BaseCodeCollection.sol',
  
  // Timeout in milliseconds
  timeout: parseInt(process.env.TIMEOUT || '600000'),
  
  // Helper function to resolve paths
  resolvePath: (filePath) => path.resolve(process.cwd(), filePath)
};

module.exports = config;