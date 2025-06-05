const {
  callListAndWait,
  saveCallListTXDataAsFile,
  getEnvVar,
} = require("../../util");

async function createPool(tokenAAddress, tokenBAddress, poolFactoryAddress) {
  if (!tokenAAddress || !tokenBAddress || !poolFactoryAddress) {
    throw new Error(
      "Token A address, Token B address, and Pool Factory address are required."
    );
  }
  // Call createPool.
  console.log("Calling createPool...");
  // Prepare call arguments for the createPool call.
  let callListArgs = [
    {
      contract: { address: poolFactoryAddress, name: "PoolFactory" },
      method: "createPool",
      args: {
        tokenA: tokenAAddress,
        tokenB: tokenBAddress,
      },
    },
  ];
  const finalResults = await callListAndWait(callListArgs);
  console.log("createPool result:", JSON.stringify(finalResults, null, 2));

  // Store pool creation information in a text file
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;

  if (final.status !== "Success") {
    throw new Error(
      `Transaction failed with status: ${final.status}. Transaction hash: ${final.hash}`
    );
  }

  const poolInfo = {
    operation: "Pool Creation",
    timestamp: new Date().toISOString(),
    factoryAddress: poolFactoryAddress,
    tokenA: tokenAAddress,
    tokenB: tokenBAddress,
    transactionHash: final.hash,
    status: final.status,
    poolAddress:
      final.status === "Success" ? final.txResult.contractsCreated[1] : "Failed",
  };

  saveCallListTXDataAsFile(poolInfo);

  return final.status === "Success" ? final.txResult.contractsCreated[1] : null;
}

async function main() {
  try {
    const TOKEN_A_ADDRESS = getEnvVar("TOKEN_A_ADDRESS");
    const TOKEN_B_ADDRESS = getEnvVar("TOKEN_B_ADDRESS");
    const POOL_FACTORY_ADDRESS = getEnvVar("POOL_FACTORY_ADDRESS");

    // Call createPool with environment variables as parameters
    const result = await createPool(
      TOKEN_A_ADDRESS,
      TOKEN_B_ADDRESS,
      POOL_FACTORY_ADDRESS
    );
    console.log("Deployed Pool contract address:", result);
  } catch (error) {
    console.error("Error in main:", error);
    process.exit(1);
  }
}

// Only run main() if this file is being executed directly, not when imported
if (require.main === module) {
  main();
}

// Add this at the end of the file
module.exports = {
  createPool,
};
