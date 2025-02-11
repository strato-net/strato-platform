const { rest, util, importer } = require('blockapps-rest');
const config = require('./load.config.js');
const oauthHelper = require('./helpers/oauthHelper.js');
const constants = require('./helpers/constants.js');

async function main() {
  try {
    // 1. Obtain the user token via oauthHelper.
    const token = await oauthHelper.getUserToken(
      process.env.METALS_USERNAME,
      process.env.METALS_PASSWORD
    );
    console.log('Token acquired:', token);

    // 2. Query Cirrus for the old reserve.
    const oldReserveAddress = process.env.OLD_RESERVE_ADDRESS;
    if (!oldReserveAddress) {
      throw new Error('OLD_RESERVE_ADDRESS environment variable is required.');
    }

    const oldReserveQuery = {
      config,
      query: {
        address: 'eq.' + oldReserveAddress,
      },
    };

    const oldReserveResults = await rest.search(
      token,
      { name: 'BlockApps-Mercata-Reserve' },
      oldReserveQuery
    );

    if (!oldReserveResults || oldReserveResults.length === 0) {
      throw new Error('No old reserve found for address: ' + oldReserveAddress);
    }

    const oldReserve = oldReserveResults[0];
    console.log('Old reserve data:', oldReserve);

    // 3. Extract required fields from the old reserve.
    const { oracle, name, assetRootAddress, unitConversionRate } = oldReserve;

    // Get additional new reserve fields from environment variables.
    const usdstToken = process.env.USDST_TOKEN;
    const usdstPrice = process.env.USDST_PRICE;
    const stratstoUSDSTFactor = process.env.STRATS_TO_USDST_FACTOR;

    // 4. Set up contract details for deployment.
    const contractName = 'SimpleReserve';
    // Use the filename provided in config (e.g., the path to your contract file)
    const contractFilename = "../dapp/mercata-base-contracts/Templates/Staking/SimpleReserve.sol";
    const source = await importer.combine(contractFilename);

    // Build the constructor arguments.
    // Note: We pass unitConversionRate as-is without using Number().
    const constructorArgs = {
      _assetOracle: oracle,
      _name: name,
      _assetRootAddress: assetRootAddress,
      _unitConversionRate: unitConversionRate,
      _usdstToken: usdstToken,
      _usdstPrice: usdstPrice,
      _stratsPrice: stratstoUSDSTFactor,
    };

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    // Deployment options: include cacheNonce and isAsync.
    const options = {
      ...config,
      history: contractName,
      cacheNonce: true,
      isAsync: true,
    };

    console.log(
      'Deploying new SimpleReserve contract via rest.createContract...'
    );
    const contract = await rest.createContract(token, contractArgs, options);
    // Remove the source from the contract object for security.
    contract.src = 'removed';

    // 5. Use util.until to poll until the new contract appears in the database.
    const searchOptions = {
      ...options,
      org: constants.blockAppsOrg,
      query: {
        address: `eq.${contract.address}`,
      },
    };

    const predicate = (results) => results && results.length > 0;
    const action = async () =>
      await rest.search(
        token,
        { name: constants.assetTableName },
        searchOptions
      );
    await util.until(predicate, action, { config }, 3600000);

    console.log(
      `New SimpleReserve contract deployed at address: ${contract.address}`
    );
  } catch (error) {
    console.error('Fatal error in deployment:', error);
  }
}

main();
