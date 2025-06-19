#!/usr/bin/env node

const { PriceOracleService } = require('../dist/services/PriceOracleService');
const logger = require('../dist/utils/logger').default;

/**
 * Deployment script for Price Oracle Service
 * This script can be used to:
 * 1. Validate configuration
 * 2. Test price feeds
 * 3. Deploy and start the service
 */

async function validateConfiguration() {
  try {
    logger.info('Validating Price Oracle configuration...');
    
    // Import and validate config
    const { validatePriceOracleConfig } = require('../dist/config/priceOracleConfig');
    validatePriceOracleConfig();
    
    logger.info('✅ Configuration validation passed');
    return true;
  } catch (error) {
    logger.error('❌ Configuration validation failed:', error.message);
    return false;
  }
}

async function testPriceFeeds() {
  try {
    logger.info('Testing price feed connections...');
    
    const service = new PriceOracleService();
    
    // Test crypto prices
    logger.info('Testing crypto price feeds...');
    const cryptoPrices = await service.fetchCryptoPrices();
    logger.info('✅ Crypto prices fetched successfully:', cryptoPrices);
    
    // Test metal prices
    logger.info('Testing metal price feeds...');
    const metalPrices = await service.fetchMetalPrices();
    logger.info('✅ Metal prices fetched successfully:', metalPrices);
    
    return true;
  } catch (error) {
    logger.error('❌ Price feed test failed:', error.message);
    return false;
  }
}

async function deployService() {
  try {
    logger.info('Deploying Price Oracle Service...');
    
    const service = new PriceOracleService();
    
    // Start the service
    await service.start();
    
    logger.info('✅ Price Oracle Service deployed and started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await service.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await service.stop();
      process.exit(0);
    });
    
    // Keep the process running
    process.stdin.resume();
    
  } catch (error) {
    logger.error('❌ Service deployment failed:', error.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'deploy';
  
  logger.info(`Starting Price Oracle deployment with command: ${command}`);
  
  switch (command) {
    case 'validate':
      const isValid = await validateConfiguration();
      process.exit(isValid ? 0 : 1);
      break;
      
    case 'test':
      const configValid = await validateConfiguration();
      if (!configValid) {
        process.exit(1);
      }
      
      const testPassed = await testPriceFeeds();
      process.exit(testPassed ? 0 : 1);
      break;
      
    case 'deploy':
    default:
      const configOk = await validateConfiguration();
      if (!configOk) {
        process.exit(1);
      }
      
      const testOk = await testPriceFeeds();
      if (!testOk) {
        logger.warn('⚠️  Price feed tests failed, but continuing with deployment...');
      }
      
      await deployService();
      break;
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in deployment script:', error);
    process.exit(1);
  });
}

module.exports = { validateConfiguration, testPriceFeeds, deployService }; 