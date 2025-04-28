const { util, importer } = require('blockapps-rest');
const { createContractArgs, getEnvVar, saveCreateTXDataAsFile } = require('../../util');

async function createERC20Simple(
  tokenName,
  tokenSymbol,
  tokenDecimals,
  tokenInitialSupply
) {
  try {
    if (!tokenName || !tokenSymbol || !tokenDecimals || !tokenInitialSupply) {
      throw new Error(
        'Token name, symbol, decimals, and initial supply are required.'
      );
    }

    // Be sure to have updated the SimpleReserve.sol contract with the correct Base Code Collection.
    const contractName = 'ERC20Simple';
    const contractFilename =
      '../../../contracts/v1/abstract/ERC20/ERC20Simple.sol';
    const source = await importer.combine(contractFilename);

    // Build the constructor arguments.
    const constructorArgs = {
      name: tokenName,
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      initialSupply: tokenInitialSupply
    };

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    const final = await createContractArgs(contractArgs);

    console.log(`New ERC20Simple contract deployed.`);
    finalContractAddress = final.txResult.contractsCreated;
    
    saveCreateTXDataAsFile(contractName, final);

    return finalContractAddress;
  } catch (error) {
    console.error('Fatal error in deployment:', error);
    throw error;
  }
}

async function main() {
    try {
        const TOKEN_NAME = getEnvVar('TOKEN_NAME');
        const TOKEN_SYMBOL = getEnvVar('TOKEN_SYMBOL');
        const TOKEN_DECIMALS = getEnvVar('TOKEN_DECIMALS');
        const TOKEN_INITIAL_SUPPLY = getEnvVar('TOKEN_INITIAL_SUPPLY');

        if (!TOKEN_NAME || !TOKEN_SYMBOL || !TOKEN_DECIMALS || !TOKEN_INITIAL_SUPPLY) {
          throw new Error(
            'TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, and TOKEN_INITIAL_SUPPLY environment variables are required.'
          );
        }
        
        // Call createERC20Simple with environment variables as parameters
        const result = await createERC20Simple(
            TOKEN_NAME,
            TOKEN_SYMBOL,
            TOKEN_DECIMALS,
            TOKEN_INITIAL_SUPPLY
        );
        console.log("Deployed contract address:", result);
    } catch (error) {
        console.error("Error in main:", error);
        process.exit(1);
    }
}

main();
