const { createERC20Simple } = require('../ERC20/createERC20Simple');
const { createMetadata } = require('../Metadata/createMetadata');
const { createNewPoolFactory } = require('../PoolFactory/createNewPoolFactory');
const { registerMetadata } = require('../Metadata/registerMetadata');
const { registerMetadataAttribute } = require('../Metadata/registerMetadataAttribute');
const { createPool } = require('../PoolFactory/createPool');
const { getEnvVar } = require('../../util');

async function deployTokensAndPool() {
    try {
        // Get environment variables for Silver Token
        const SILVER_NAME = getEnvVar('SILVER_NAME');
        const SILVER_SYMBOL = getEnvVar('SILVER_SYMBOL');
        const SILVER_DECIMALS = getEnvVar('SILVER_DECIMALS');
        const SILVER_INITIAL_SUPPLY = getEnvVar('SILVER_INITIAL_SUPPLY');
        const SILVER_DESCRIPTION = getEnvVar('SILVER_DESCRIPTION');
        const SILVER_IMAGES = getEnvVar('SILVER_IMAGES');
        const SILVER_FILES = getEnvVar('SILVER_FILES');
        const SILVER_FILE_NAMES = getEnvVar('SILVER_FILE_NAMES');
        // Get environment variables for USDST Token
        const USDST_NAME = getEnvVar('USDST_NAME');
        const USDST_SYMBOL = getEnvVar('USDST_SYMBOL');
        const USDST_DECIMALS = getEnvVar('USDST_DECIMALS');
        const USDST_INITIAL_SUPPLY = getEnvVar('USDST_INITIAL_SUPPLY');
        const USDST_DESCRIPTION = getEnvVar('USDST_DESCRIPTION');
        const USDST_IMAGES = getEnvVar('USDST_IMAGES');
        const USDST_FILES = getEnvVar('USDST_FILES');
        const USDST_FILE_NAMES = getEnvVar('USDST_FILE_NAMES');

        console.log('Creating Silver Token...');
        const silverTokenAddress = await createERC20Simple(
            SILVER_NAME,
            SILVER_SYMBOL,
            SILVER_DECIMALS,
            SILVER_INITIAL_SUPPLY
        );
        console.log('Silver Token created at address:', silverTokenAddress);

        console.log('Creating USDST Token...');
        const usdstTokenAddress = await createERC20Simple(
            USDST_NAME,
            USDST_SYMBOL,
            USDST_DECIMALS,
            USDST_INITIAL_SUPPLY
        );
        console.log('USDST Token created at address:', usdstTokenAddress);

        console.log('Creating Metadata Contract...');
        const metadataAddress = await createMetadata();
        console.log('Metadata Contract created at address:', metadataAddress);

        console.log('Creating Pool Factory Contract...');
        const poolFactoryAddress = await createNewPoolFactory();
        console.log('Pool Factory Contract created at address:', poolFactoryAddress);

        console.log('Registering Metadata for Silver Token...');
        const silverMetadataInfo = {
            tokenAddress: silverTokenAddress,
            tokenName: SILVER_NAME,
            tokenDescription: SILVER_DESCRIPTION,
            tokenImages: SILVER_IMAGES,
            tokenFiles: SILVER_FILES,
            tokenFileNames: SILVER_FILE_NAMES,
            tokenCreatedDate: new Date().toISOString(),
            metadataAddress: metadataAddress
        };
        await registerMetadata(
            silverMetadataInfo.tokenAddress,
            silverMetadataInfo.tokenName,
            silverMetadataInfo.tokenDescription,
            silverMetadataInfo.tokenImages,
            silverMetadataInfo.tokenFiles,
            silverMetadataInfo.tokenFileNames,
            silverMetadataInfo.tokenCreatedDate,
            silverMetadataInfo.metadataAddress
        );
        console.log('Silver Token metadata registered');

        console.log('Registering Metadata Attributes for Silver Token...');

        const tokenAttributes = getEnvVar('SILVER_TOKEN_ATTRIBUTES');

        console.log('Token attributes:', tokenAttributes);
        await registerMetadataAttribute(
            silverTokenAddress,
            tokenAttributes,
            metadataAddress
        );
        console.log('Silver Token metadata attributes registered');

        console.log('Registering Metadata for USDST Token...');
        const usdstMetadataInfo = {
            tokenAddress: usdstTokenAddress,
            tokenName: USDST_NAME,
            tokenDescription: USDST_DESCRIPTION,
            tokenImages: USDST_IMAGES,
            tokenFiles: USDST_FILES,
            tokenFileNames: USDST_FILE_NAMES,
            tokenCreatedDate: new Date().toISOString(),
            metadataAddress: metadataAddress
        };
        await registerMetadata(
            usdstMetadataInfo.tokenAddress,
            usdstMetadataInfo.tokenName,
            usdstMetadataInfo.tokenDescription,
            usdstMetadataInfo.tokenImages,
            usdstMetadataInfo.tokenFiles,
            usdstMetadataInfo.tokenFileNames,
            usdstMetadataInfo.tokenCreatedDate,
            usdstMetadataInfo.metadataAddress
        );
        console.log('USDST Token metadata registered');
        
        console.log('Creating Pool for Silver and USDST Tokens...');
        const poolAddress = await createPool(
            silverTokenAddress,
            usdstTokenAddress,
            poolFactoryAddress
        );
        console.log('Pool created at address:', poolAddress);

        return {
            silverTokenAddress,
            usdstTokenAddress,
            metadataAddress,
            poolFactoryAddress,
            poolAddress
        };
    } catch (error) {
        console.error('Error in deployTokensAndPool:', error);
        throw error;
    }
}

async function main() {
    try {
        const result = await deployTokensAndPool();
        console.log(result);
    } catch (error) {
        console.error('Fatal error in deployment:', error);
        process.exit(1);
    }
}

main();

