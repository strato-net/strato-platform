const { util } = require('blockapps-rest');
const { callListAndWait, getEnvVar } = require('../../util');

async function registerMetadata(
  tokenAddress,
  tokenName,
  tokenDescription,
  tokenImages,
  tokenFiles,
  tokenFileNames,
  tokenCreatedDate,
  metadataAddress
) {
  try {
    if (!tokenAddress || !metadataAddress) {
      throw new Error('Token address and metadata address are required.');
    }

    // Call registerMetadata.
    console.log('Calling registerMetadata...');
    // Prepare call arguments for the registerMetadata call.
    let callListArgs = [
      {
        contract: { address: metadataAddress, name: 'SimpleTokenMetadata' },
        method: 'registerMetadata',
        args: util.usc({
          tokenAddress: tokenAddress,
          name: tokenName,
          description: tokenDescription,
          images: tokenImages,
          files: tokenFiles,
          fileNames: tokenFileNames,
          createdDate: tokenCreatedDate,
        }),
      },
    ];
    const finalResults = await callListAndWait(callListArgs);
    console.log(
      'registerMetadata result:',
      JSON.stringify(finalResults, null, 2)
    );
    return finalResults;
  } catch (error) {
    console.error('Error in registerMetadata:', error);
    throw error;
  }
}

async function main() {
  try {
    const TOKEN_ADDRESS = getEnvVar('TOKEN_ADDRESS');
    const TOKEN_NAME = getEnvVar('TOKEN_NAME');
    const TOKEN_DESCRIPTION = getEnvVar('TOKEN_DESCRIPTION');
    const TOKEN_IMAGES = getEnvVar('TOKEN_IMAGES');
    const TOKEN_FILES = getEnvVar('TOKEN_FILES');
    const TOKEN_FILE_NAMES = getEnvVar('TOKEN_FILE_NAMES');
    const TOKEN_CREATED_DATE = getEnvVar('TOKEN_CREATED_DATE');
    const METADATA_ADDRESS = getEnvVar('METADATA_ADDRESS');

    // Validate environment variables
    if (!USERNAME || !PASSWORD) {
      throw new Error('USERNAME and PASSWORD environment variables are required.');
    }

    if (!TOKEN_ADDRESS || !METADATA_ADDRESS) {
      throw new Error('TOKEN_ADDRESS and METADATA_ADDRESS environment variables are required.');
    }

    // Call registerMetadata with environment variables as parameters
    const result = await registerMetadata(
      TOKEN_ADDRESS,
      TOKEN_NAME,
      TOKEN_DESCRIPTION,
      TOKEN_IMAGES,
      TOKEN_FILES,
      TOKEN_FILE_NAMES,
      TOKEN_CREATED_DATE,
      METADATA_ADDRESS
    );
    console.log("Register metadata result:", result);
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
  registerMetadata
};