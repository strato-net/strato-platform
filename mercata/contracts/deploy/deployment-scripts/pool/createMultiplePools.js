const { createPool } = require("./createPool");
const { getEnvVar } = require("../../util");
const fs = require("fs");
const path = require("path");

/**
 * Parse pool configurations from environment variables
 * Expected format: POOL_CONFIGS='{"pools":[{"tokenA":"937efa7e3a77e20bbdbd7c0d32b6514f368c1010","tokenB":"cdc93d30182125e05eec985b631c7c61b3f63ff0"}]}'
 */
function parsePoolConfigs() {
  try {
    const poolConfigsStr = getEnvVar("POOL_CONFIGS");
    if (!poolConfigsStr) {
      throw new Error("POOL_CONFIGS environment variable is required");
    }
    
    const config = JSON.parse(poolConfigsStr);
    return config.pools || [];
  } catch (error) {
    console.error("Error parsing POOL_CONFIGS:", error.message);
    throw new Error("Invalid POOL_CONFIGS format. Expected JSON with 'pools' array.");
  }
}

/**
 * Save pool addresses to a file
 */
function savePoolAddresses(poolAddresses, poolConfigs) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `pool-addresses-${timestamp}.json`;
  const filepath = path.join(__dirname, filename);
  
  const data = {
    timestamp: new Date().toISOString(),
    totalPools: poolAddresses.length,
    pools: poolConfigs.map((config, index) => ({
      poolIndex: index + 1,
      tokenA: config.tokenA,
      tokenB: config.tokenB,
      poolAddress: poolAddresses[index],
      config: config
    }))
  };
  
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`Pool addresses saved to: ${filepath}`);
  return filepath;
}

/**
 * Create multiple pools and save their addresses
 */
async function createMultiplePools() {
  try {
    const poolConfigs = parsePoolConfigs();
    const poolFactoryAddress = getEnvVar("POOL_FACTORY_ADDRESS");
    
    if (!poolFactoryAddress) {
      throw new Error("POOL_FACTORY_ADDRESS environment variable is required");
    }
    
    console.log(`Creating ${poolConfigs.length} pools...`);
    
    const poolAddresses = [];
    
    for (let i = 0; i < poolConfigs.length; i++) {
      const config = poolConfigs[i];
      console.log(`\nCreating pool ${i + 1}/${poolConfigs.length}...`);
      console.log(`Token A: ${config.tokenA}`);
      console.log(`Token B: ${config.tokenB}`);
      
      try {
        const poolAddress = await createPool(
          config.tokenA,
          config.tokenB,
          poolFactoryAddress
        );
        
        poolAddresses.push(poolAddress);
        console.log(`✅ Pool ${i + 1} created successfully at: ${poolAddress}`);
        
      } catch (error) {
        console.error(`❌ Failed to create pool ${i + 1}:`, error.message);
        // Continue with other pools even if one fails
        poolAddresses.push(null);
      }
    }
    
    // Save successful pool addresses
    const successfulPools = poolAddresses.filter(addr => addr !== null);
    const successfulConfigs = poolConfigs.filter((_, index) => poolAddresses[index] !== null);
    
    if (successfulPools.length > 0) {
      const filepath = savePoolAddresses(successfulPools, successfulConfigs);
      console.log(`\n🎉 Successfully created ${successfulPools.length}/${poolConfigs.length} pools`);
      console.log(`Pool addresses saved to: ${filepath}`);
    } else {
      console.log("\n❌ No pools were created successfully");
    }
    
    return {
      totalRequested: poolConfigs.length,
      successful: successfulPools.length,
      failed: poolConfigs.length - successfulPools.length,
      addresses: successfulPools,
      filepath: successfulPools.length > 0 ? savePoolAddresses(successfulPools, successfulConfigs) : null
    };
    
  } catch (error) {
    console.error("Error creating multiple pools:", error.message);
    throw error;
  }
}

async function main() {
  try {
    const result = await createMultiplePools();
    console.log("\n📊 Summary:");
    console.log(`Total pools requested: ${result.totalRequested}`);
    console.log(`Successfully created: ${result.successful}`);
    console.log(`Failed: ${result.failed}`);
    
    if (result.addresses.length > 0) {
      console.log("\n📍 Pool addresses:");
      result.addresses.forEach((address, index) => {
        console.log(`Pool ${index + 1}: ${address}`);
      });
    }
    
  } catch (error) {
    console.error("Fatal error:", error.message);
    process.exit(1);
  }
}

// Only run main() if this file is being executed directly
if (require.main === module) {
  main();
}

module.exports = {
  createMultiplePools,
  parsePoolConfigs,
  savePoolAddresses
};