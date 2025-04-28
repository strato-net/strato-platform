const {util, importer} = require('blockapps-rest');
const { createContractArgs, saveCreateTXDataAsFile } = require('../../util');

async function createNewPoolFactory() {
  try {
    const contractName = 'SimplePoolFactory';
    const contractFilename =
      '../../../contracts/v1/abstract/Pools/SimplePoolFactory.sol';
    const source = await importer.combine(contractFilename);

    // Build the constructor arguments.
    const constructorArgs = {};

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    const final = await createContractArgs(contractArgs);

    console.log(`New SimplePoolFactory contract deployed.`);
    
    const contractAddress = final.txResult.contractsCreated;
    
    saveCreateTXDataAsFile(contractName, final);

    return contractAddress;
  } catch (error) {
    console.error('Fatal error in deployment:', error);
    throw error;
  }
}

async function main() {
  try {
    // Call createNewPoolFactory with environment variables as parameters
    const result = await createNewPoolFactory();
    console.log("Deployed PoolFactory contract address:", result);
  } catch (error) {
    console.error("Error in main:", error);
    process.exit(1);
  }
}

main();
