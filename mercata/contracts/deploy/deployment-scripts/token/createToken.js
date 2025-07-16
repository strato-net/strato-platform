const { util, importer } = require("blockapps-rest");
const {
  createContractArgs,
  getEnvVar,
  saveCreateTXDataAsFile,
} = require("../../util");

async function createToken(
  tokenName,
  tokenDescription,
  tokenImages,
  tokenFiles,
  tokenFileNames,
  tokenSymbol,
  tokenInitialSupply,
  tokenDecimals
) {
  try {
    if (!tokenName || !tokenSymbol || !tokenInitialSupply || !tokenDecimals) {
      throw new Error("Token name, symbol, supply, and decimals are required.");
    }

    if (!process.env.BASE_CODE_COLLECTION) {
      throw new Error(
        "BASE_CODE_COLLECTION environment variable not set. Please set it before running this script."
      );
    }

    const contractName = "Token";
    const source = `import <${process.env.BASE_CODE_COLLECTION}>;`;

    // Build the constructor arguments.
    const constructorArgs = {
      name: tokenName,
      description: tokenDescription,
      images: tokenImages,
      files: tokenFiles,
      fileNames: tokenFileNames,
      symbol: tokenSymbol,
      initialSupply: tokenInitialSupply,
      customDecimals: tokenDecimals,
    };

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    const final = await createContractArgs(contractArgs);

    console.log(`New Token contract deployed.`);
    finalContractAddress = final.txResult.contractsCreated;

    saveCreateTXDataAsFile(contractName, final);

    return finalContractAddress;
  } catch (error) {
    console.error("Fatal error in deployment:", error);
    throw error;
  }
}

async function main() {
  try {
    const TOKEN_NAME = getEnvVar("TOKEN_NAME");
    const TOKEN_DESCRIPTION = getEnvVar("TOKEN_DESCRIPTION");
    const TOKEN_IMAGES = JSON.parse(getEnvVar("TOKEN_IMAGES"));
    const TOKEN_FILES = JSON.parse(getEnvVar("TOKEN_FILES"));
    const TOKEN_FILE_NAMES = JSON.parse(getEnvVar("TOKEN_FILE_NAMES"));
    const TOKEN_SYMBOL = getEnvVar("TOKEN_SYMBOL");
    const TOKEN_INITIAL_SUPPLY = getEnvVar("TOKEN_INITIAL_SUPPLY");
    const TOKEN_DECIMALS = getEnvVar("TOKEN_DECIMALS");

    if (
      !TOKEN_NAME ||
      !TOKEN_SYMBOL ||
      !TOKEN_INITIAL_SUPPLY ||
      !TOKEN_DECIMALS
    ) {
      throw new Error(
        "Required environment variables: TOKEN_NAME, TOKEN_SYMBOL, TOKEN_INITIAL_SUPPLY, and TOKEN_DECIMALS."
      );
    }

    // Call createToken with environment variables as parameters
    const result = await createToken(
      TOKEN_NAME,
      TOKEN_DESCRIPTION,
      TOKEN_IMAGES,
      TOKEN_FILES,
      TOKEN_FILE_NAMES,
      TOKEN_SYMBOL,
      TOKEN_INITIAL_SUPPLY,
      TOKEN_DECIMALS
    );
    console.log("Deployed Token contract address:", result);
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
  createToken,
};
