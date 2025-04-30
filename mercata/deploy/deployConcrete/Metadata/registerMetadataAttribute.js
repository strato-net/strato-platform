const { util } = require('blockapps-rest');
const { callListAndWait, getEnvVar } = require('../../util');

async function registerMetadataAttribute(
  tokenAddress,
  tokenAttributes,
  metadataAddress
) {
  try {

    if (!tokenAddress || !tokenAttributes || !metadataAddress) {
      throw new Error('Token address, token attributes, and metadata address are required.');
    }

    // Call registerMetadata.
    console.log('Calling registerMetadataAttribute...');
    // Prepare call arguments for the registerMetadataAttribute call.
    let callListArgs = [
      {
        contract: { address: metadataAddress, name: 'SimpleTokenMetadata' },
        method: 'registerMetadataAttribute',
        args: util.usc({
          tokenAddress: tokenAddress,
          attributes: tokenAttributes
        }),
      },
    ];
    const finalResults = await callListAndWait(callListArgs);
    console.log(
      'registerMetadataAttribute result:',
      JSON.stringify(finalResults, null, 2)
    );
    return finalResults;
  } catch (error) {
    console.error('Error in registerMetadataAttribute:', error);
    throw error;
  }
}

async function main() {
  try {
    // Read environment variables
    const USERNAME = getEnvVar('USERNAME');
    const PASSWORD = getEnvVar('PASSWORD');
    const TOKEN_ADDRESS = getEnvVar('TOKEN_ADDRESS');
    const TOKEN_ATTRIBUTES = getEnvVar('TOKEN_ATTRIBUTES');
    const METADATA_ADDRESS = getEnvVar('METADATA_ADDRESS');

    // Validate environment variables
    if (!USERNAME || !PASSWORD) {
      throw new Error('USERNAME and PASSWORD environment variables are required.');
    }

    if (!TOKEN_ADDRESS || !TOKEN_ATTRIBUTES || !METADATA_ADDRESS) {
      throw new Error('TOKEN_ADDRESS, TOKEN_ATTRIBUTES, and METADATA_ADDRESS environment variables are required.');
    }

    // Call registerMetadataAttribute with environment variables as parameters
    const result = await registerMetadataAttribute(
      USERNAME,
      PASSWORD,
      TOKEN_ADDRESS,
      TOKEN_ATTRIBUTES,
      METADATA_ADDRESS
    );
    console.log("Register metadata attribute result:", result);
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
  registerMetadataAttribute
};