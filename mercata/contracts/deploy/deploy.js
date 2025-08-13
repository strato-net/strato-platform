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
    console.log(`Rate Strategy: ${deployedContract.managers.rateStrategy}`);
    console.log(`Collateral Vault: ${deployedContract.managers.collateralVault}`);
    console.log(`Price Oracle: ${deployedContract.managers.priceOracle}`);
    console.log(`Pool Configurator: ${deployedContract.managers.poolConfigurator}`);
    console.log(`Lending Pool: ${deployedContract.managers.lendingPool}`);
    console.log(`Liquidity Pool: ${deployedContract.managers.liquidityPool}`);
    console.log(`Lending Registry: ${deployedContract.managers.lendingRegistry}`);
    console.log(`Mercata Bridge: ${deployedContract.managers.mercataBridge}`);
    console.log(`On Ramp: ${deployedContract.managers.onRamp}`);
    console.log(`Pool Factory: ${deployedContract.managers.poolFactory}`);
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
      POOL_FACTORY: deployedContract.managers.poolFactory,
      TOKEN_FACTORY: deployedContract.managers.tokenFactory,
      ADMIN_REGISTRY: deployedContract.managers.adminRegistry,
      FEE_COLLECTOR: deployedContract.managers.feeCollector,
      PRICE_ORACLE: deployedContract.managers.priceOracle,
      RATE_STRATEGY: deployedContract.managers.rateStrategy,
      LIQUIDITY_POOL: deployedContract.managers.liquidityPool,
      COLLATERAL_VAULT: deployedContract.managers.collateralVault,
      LENDING_POOL: deployedContract.managers.lendingPool,
      LENDING_REGISTRY: deployedContract.managers.lendingRegistry,
      POOL_CONFIGURATOR: deployedContract.managers.poolConfigurator,
      MERCATA_BRIDGE: deployedContract.managers.mercataBridge,
      ON_RAMP: deployedContract.managers.onRamp,
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