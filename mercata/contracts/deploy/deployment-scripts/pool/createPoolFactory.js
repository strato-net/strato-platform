const { util } = require("blockapps-rest");
const { createContractArgs, saveCreateTXDataAsFile } = require("../../util");

async function createPoolFactory() {
  try {
    if (!process.env.BASE_CODE_COLLECTION) {
      throw new Error(
        "BASE_CODE_COLLECTION environment variable not set. Please set it before running this script."
      );
    }

    const contractName = "PoolFactory";
    const source = `import <${process.env.BASE_CODE_COLLECTION}>;`;

    // Build the constructor arguments.
    const constructorArgs = {};

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    const final = await createContractArgs(contractArgs);

    console.log(`New PoolFactory contract deployed.`);

    const contractAddress = final.txResult.contractsCreated;

    saveCreateTXDataAsFile(contractName, final);

    return contractAddress;
  } catch (error) {
    console.error("Fatal error in deployment:", error);
    throw error;
  }
}

async function main() {
  try {
    // Call createPoolFactory with environment variables as parameters
    const result = await createPoolFactory();
    console.log("Deployed PoolFactory contract address:", result);
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
  createPoolFactory,
};
