const { callListAndWait } = require("../../util");
const fs = require("fs");
const path = require("path");

// Contract addresses
const BA_TEST_ADDRESS = "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
const USDST_ADDRESS = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";

/**
 * Convert decimal amount to wei (18 decimals)
 * Similar to ethers.js parseUnits function
 */
function toWei(amount) {
  const parts = amount.toString().split('.');
  const wholePart = parts[0];
  const decimalPart = parts[1] || '';
  
  // Pad decimal part to 18 digits
  const paddedDecimal = decimalPart.padEnd(18, '0').slice(0, 18);
  
  return wholePart + paddedDecimal;
}

/**
 * Save results to a JSON file
 */
function saveResults(poolConfigs, batchCalls, batchResults) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `pool-population-results-${timestamp}.json`;
  const filepath = path.join(__dirname, filename);
  
  const results = {
    timestamp: new Date().toISOString(),
    summary: {
      totalPools: poolConfigs.length,
      totalOperations: batchCalls.length,
      successfulOperations: batchResults.filter(r => r.status === "Success").length,
      failedOperations: batchResults.filter(r => r.status !== "Success").length
    },
    pools: poolConfigs.map((config, index) => ({
      poolIndex: index + 1,
      name: config.name,
      tokenA: config.tokenA,
      tokenB: config.tokenB,
      poolAddress: config.poolAddress,
      tokenAMintAmount: config.tokenAMintAmount,
      tokenBMintAmount: config.tokenBMintAmount
    })),
    operations: batchCalls.map((call, index) => ({
      operationIndex: index + 1,
      contract: call.contract.name,
      contractAddress: call.contract.address,
      method: call.method,
      args: call.args,
      status: batchResults[index]?.status || "Unknown",
      transactionHash: batchResults[index]?.hash || null,
      error: batchResults[index]?.status !== "Success" ? batchResults[index]?.error || "Unknown error" : null
    }))
  };
  
  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to: ${filepath}`);
  return filepath;
}

// Pool addresses from your deployment
const POOL_ADDRESSES = {
  WBTCST: "55d9e1551f52dcc3d3c233e002a0a4421fb81ff8",
  GOLDST: "34d7caf576cf9493f054d9eced99dcd463eba4b7", 
  SILVST: "f115302afd125d048caedd47353f01d1a5e9dba8",
  USDTST: "50160ce5184913cada2660ab51a4f464f904d5eb",
  USDCST: "d86cb1d4d55328b0837d32ecf2c78ac2ff490b3a",
  PAXGST: "ff2befcd850183170627dcbc377c3fd573789172",
  ETHST: "cb85e12ca5d98de95715fc75ae251a66b662ea06"
};

// Pool configurations with token pairs and mint amounts
const POOL_CONFIGS = [
  {
    name: "WBTCST-USDST",
    tokenA: "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9", // WBTCST
    tokenB: USDST_ADDRESS,
    poolAddress: POOL_ADDRESSES.WBTCST,
    tokenAMintAmount: toWei("1.7"), // 1.7 WBTCST
    tokenBMintAmount: toWei("200000") // 200,000 USDST
  },
  {
    name: "GOLDST-USDST", 
    tokenA: "cdc93d30182125e05eec985b631c7c61b3f63ff0", // GOLDST
    tokenB: USDST_ADDRESS,
    poolAddress: POOL_ADDRESSES.GOLDST,
    tokenAMintAmount: toWei("60.4"), // 60.4 GOLDST
    tokenBMintAmount: toWei("200000") // 200,000 USDST
  },
  {
    name: "SILVST-USDST",
    tokenA: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94", // SILVST
    tokenB: USDST_ADDRESS,
    poolAddress: POOL_ADDRESSES.SILVST,
    tokenAMintAmount: toWei("5250"), // 5250 SILVST
    tokenBMintAmount: toWei("200000") // 200,000 USDST
  },
  {
    name: "USDTST-USDST",
    tokenA: "86a5ae535ded415203c3e27d654f9a1d454c553b", // USDTST
    tokenB: USDST_ADDRESS,
    poolAddress: POOL_ADDRESSES.USDTST,
    tokenAMintAmount: toWei("200000"), // 200,000 USDTST
    tokenBMintAmount: toWei("200000") // 200,000 USDST
  },
  {
    name: "USDCST-USDST",
    tokenA: "3d351a4a339f6eef7371b0b1b025b3a434ad0399", // USDCST
    tokenB: USDST_ADDRESS,
    poolAddress: POOL_ADDRESSES.USDCST,
    tokenAMintAmount: toWei("200000"), // 200,000 USDCST
    tokenBMintAmount: toWei("200000") // 200,000 USDST
  },
  {
    name: "PAXGST-USDST",
    tokenA: "491cdfe98470bfe69b662ab368826dca0fc2f24d", // PAXGST
    tokenB: USDST_ADDRESS,
    poolAddress: POOL_ADDRESSES.PAXGST,
    tokenAMintAmount: toWei("59.8"), // 59.8 PAXGST
    tokenBMintAmount: toWei("200000") // 200,000 USDST
  }
];

/**
 * Generate batch calls for minting tokens and adding liquidity to all pools
 */
function generateBatchCalls() {
  const batchCalls = [];
  
  console.log("Generating batch calls for all pools...");
  
  for (let i = 0; i < POOL_CONFIGS.length; i++) {
    const config = POOL_CONFIGS[i];
    console.log(`Processing pool ${i + 1}/${POOL_CONFIGS.length}: ${config.name}`);
    
    // Mint tokenA for this pool
    batchCalls.push({
      contract: { address: config.tokenA, name: "Token" },
      method: "mint",
      args: {
        to: BA_TEST_ADDRESS,
        amount: config.tokenAMintAmount,
      },
    });
    
    // Mint USDST (tokenB) for this pool
    batchCalls.push({
      contract: { address: config.tokenB, name: "Token" },
      method: "mint",
      args: {
        to: BA_TEST_ADDRESS,
        amount: config.tokenBMintAmount,
      },
    });
    
    // Approve tokenA for pool (using minted amount)
    batchCalls.push({
      contract: { address: config.tokenA, name: "Token" },
      method: "approve",
      args: {
        spender: config.poolAddress,
        value: config.tokenAMintAmount,
      },
    });
    
    // Approve USDST (tokenB) for pool (using minted amount)
    batchCalls.push({
      contract: { address: config.tokenB, name: "Token" },
      method: "approve",
      args: {
        spender: config.poolAddress,
        value: config.tokenBMintAmount,
      },
    });
    
    // Add liquidity to pool (using minted amounts)
    batchCalls.push({
      contract: { address: config.poolAddress, name: "Pool" },
      method: "addLiquidity",
      args: {
        tokenBAmount: config.tokenBMintAmount,
        maxTokenAAmount: config.tokenAMintAmount,
      },
    });
  }
  
  return batchCalls;
}

/**
 * Populate all pools with token minting and liquidity
 */
async function populatePools() {
  console.log(`Populating ${POOL_CONFIGS.length} pools with token minting and liquidity...`);
  
  // Verify all pool addresses exist
  for (const config of POOL_CONFIGS) {
    console.log(`Pool: ${config.name} at ${config.poolAddress}`);
  }
  
  return POOL_CONFIGS.map(config => config.poolAddress);
}

if (require.main === module) {
  (async () => {
    try {
      const poolAddresses = await populatePools();
      console.log("Pool addresses:", poolAddresses);
      
      const batchCalls = generateBatchCalls();
      
      console.log(`Executing ${batchCalls.length} batch operations for ${POOL_CONFIGS.length} pools...`);
      
      const batchResults = await callListAndWait(batchCalls);

      // Log the result of each batch call, counting failures
      let failureCount = 0;
      batchResults.forEach((result, index) => {
        const call = batchCalls[index];
        if (result.status !== "Success") {
          failureCount++;
          console.log(
            `Batch call FAILED: contract ${call.contract.name} at ${call.contract.address}, method ${call.method} returned status ${result.status}. Transaction hash: ${result.hash}`
          );
        } else {
          console.log(
            `Batch call succeeded: contract ${call.contract.name} at ${call.contract.address}, method ${call.method}, transaction hash: ${result.hash}`
          );
        }
      });

      if (failureCount > 0) {
        console.log(
          `${failureCount} out of ${batchResults.length} batch calls failed.`
        );
      } else {
        console.log("All batch transactions completed successfully.");
      }
      
      // Save results to file
      const resultsFile = saveResults(POOL_CONFIGS, batchCalls, batchResults);
      
      console.log("Pool population completed successfully!");
      console.log("Pool addresses:", poolAddresses);
      console.log(`Results saved to: ${resultsFile}`);
      
    } catch (error) {
      console.error("Pool population failed:", error.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  populatePools,
  generateBatchCalls,
  toWei,
  saveResults,
};