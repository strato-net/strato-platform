/**
 * Main deployment script for BlockApps contracts
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { uploadDappContract } = require('./contract');

/**
 * Main deployment function
 */
async function main() {
  try {
    console.log('Starting contract deployment process...');
    
    // Check for required environment variables
    const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
      console.error('Please set them in your .env file and try again');
      process.exit(1);
    }
    
    // Get admin credentials
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    
    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    
    // Get user info
    console.log(`Authenticated as ${username}`);
    
    // Set options
    const options = { 
      config,
      logger: console
    };
    
    // Deploy the contract
    console.log(`Using contracts directory: ${config.contractsDir}`);
    const deployedContract = await uploadDappContract(tokenObj, options);
    
    console.log('\n====== Deployment Successful ======');
    console.log(`Contract: ${deployedContract.name}`);
    console.log(`Address: ${deployedContract.address}`);
    console.log(`CDP Registry: ${deployedContract.managers.cdpRegistry}`);
    console.log(`CDP Engine: ${deployedContract.managers.cdpEngine}`);
    console.log(`CDP Vault: ${deployedContract.managers.cdpVault}`);
    console.log(`USDST Token: ${deployedContract.managers.usdst}`);
    console.log(`Price Oracle: ${deployedContract.managers.priceOracle}`);
    console.log(`Token Factory: ${deployedContract.managers.tokenFactory}`);
    console.log(`Fee Collector: ${deployedContract.managers.feeCollector}`);
    console.log(`Admin Registry: ${deployedContract.managers.adminRegistry}`);

    console.log('===================================\n');
    
    // Return the deployed contract address for scripting
    console.log(`DEPLOYED_CONTRACT_ADDRESS=${deployedContract.address}`);
    
    // Helpful .env snippet so the operator can paste straight into their environment
    console.log('\n# ------------------------');
    console.log('# Paste these into your .env');
    console.log('# ------------------------');
    const envLines = {
      CDP_REGISTRY: deployedContract.managers.cdpRegistry,
      CDP_ENGINE: deployedContract.managers.cdpEngine,
      CDP_VAULT: deployedContract.managers.cdpVault,
      USDST_TOKEN: deployedContract.managers.usdst,
      PRICE_ORACLE: deployedContract.managers.priceOracle,
      TOKEN_FACTORY: deployedContract.managers.tokenFactory,
      FEE_COLLECTOR: deployedContract.managers.feeCollector,
      ADMIN_REGISTRY: deployedContract.managers.adminRegistry,
      MERCATA_CORE: deployedContract.address,
    };
    Object.entries(envLines).forEach(([k, v]) => {
      console.log(`${k}=${v}`);
    });
    console.log('# ------------------------\n');
    
    return deployedContract;
  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = main;