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
  contractsDir: `./contracts/${process.env.CONTRACT_VERSION || 'v1'}/abstract`,
  mainFile: process.env.MAIN_FILE || 'BaseCodeCollection.sol',
  appName: process.env.APP_NAME || 'Mercata',
  
  // Helper function to resolve paths
  resolvePath: (filePath) => path.resolve(process.cwd(), filePath)
};

module.exports = config;