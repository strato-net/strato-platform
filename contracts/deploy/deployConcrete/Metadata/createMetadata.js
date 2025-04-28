// Load environment variables from .env file.
const { util, importer } = require('blockapps-rest');
const { createContractArgs, saveCreateTXDataAsFile } = require('../../util');

async function createMetadata(username, password) {
  try {
    // Be sure to have updated the SimpleTokenMetadata.sol contract with the correct Base Code Collection.
    const contractName = 'Metadata';
    const contractFilename =
      '../../../contracts/v1/abstract/Tokens/Metadata/SimpleTokenMetadata.sol';
    const source = await importer.combine(contractFilename);

    // Build the constructor arguments.
    const constructorArgs = {
    };

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    const final = await createContractArgs(contractArgs);

    console.log(`New Metadata contract deployed.`);
    finalContractAddress = final.contractAddress || final.address;
    
    saveCreateTXDataAsFile(contractName, final);
    return finalContractAddress;
  } catch (error) {
    console.error('Fatal error in deployment:', error);
    throw error;
  }
}

async function main() {
    try {
        // Call createMetadata with environment variables as parameters
        const result = await createMetadata();
        console.log("Deployed Metadata contract address:", result);
    } catch (error) {
        console.error("Error in main:", error);
        process.exit(1);
    }
}

main();
