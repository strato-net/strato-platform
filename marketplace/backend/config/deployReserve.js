// Load environment variables from .env file.
require('dotenv').config();

const { rest, util, importer, fsUtil, oauthUtil } = require('blockapps-rest');

// Load configuration from a YAML file.
const config = fsUtil.getYaml(`../config.yaml`);

/**
 * Obtains a user token using the OAuth resource owner credentials.
 *
 * @param {string} username - The username to use.
 * @param {string} password - The password to use.
 * @param {object|null} req - (Optional) Express request object to extract the OAuth instance.
 * @returns {Promise<string>} - The access token.
 */
const getUserToken = async (username, password, req = null) => {
  const oauth = req
    ? req.app.oauth
    : await oauthUtil.init(config.nodes[0].oauth);
  const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
    username,
    password
  );
  const tokenField = config.nodes[0].oauth.tokenField || 'access_token';
  return tokenObj.token[tokenField];
};

async function main() {
  try {
    // Destructure and validate required environment variables.
    const {
      USERNAME,
      PASSWORD,
      OLD_RESERVE_ADDRESS,
      USDST_TOKEN,
      USDST_PRICE,
      STRATS_TO_USDST_FACTOR,
    } = process.env;

    if (!USERNAME || !PASSWORD) {
      throw new Error(
        'USERNAME and PASSWORD environment variables are required.'
      );
    }
    if (!OLD_RESERVE_ADDRESS) {
      throw new Error('OLD_RESERVE_ADDRESS environment variable is required.');
    }

    // 1. Obtain the user token via OAuth.
    const tokenString = await getUserToken(USERNAME, PASSWORD);
    if (!tokenString) {
      throw new Error('Failed to acquire token.');
    }
    console.log('Token acquired:', tokenString);
    const token = { token: tokenString };

    // 2. Query Cirrus for the old reserve.
    const oldReserveQuery = {
      config,
      query: {
        address: 'eq.' + OLD_RESERVE_ADDRESS,
      },
    };

    const oldReserveResults = await rest.search(
      token,
      { name: 'BlockApps-Mercata-Reserve' },
      oldReserveQuery
    );

    if (!oldReserveResults || oldReserveResults.length === 0) {
      throw new Error(
        `No old reserve found for address: ${OLD_RESERVE_ADDRESS}`
      );
    }

    const oldReserve = oldReserveResults[0];

    // 3. Extract required fields from the old reserve.
    const { oracle, name, assetRootAddress, unitConversionRate } = oldReserve;

    // 4. Set up contract details for deployment.
    const contractName = 'SimpleReserve';
    const contractFilename =
      '../dapp/mercata-base-contracts/Templates/Staking/SimpleReserve.sol';
    const source = await importer.combine(contractFilename);

    // Build the constructor arguments.
    const constructorArgs = {
      assetOracle: oracle,
      name: name,
      assetRootAddress: assetRootAddress,
      unitConversionRate: unitConversionRate,
      usdstToken: USDST_TOKEN,
      usdstPrice: Number(USDST_PRICE),
      stratsPrice: Number(STRATS_TO_USDST_FACTOR),
    };

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    // Deployment options.
    const options = {
      config,
      history: contractName,
      cacheNonce: true,
      isAsync: true,
    };
    console.log('Contract args:', contractArgs);
    console.log('Deployment options:', options);
    console.log(
      'Deploying new SimpleReserve contract via rest.createContract...'
    );
    const response = await rest.createContract(token, contractArgs, options);

    // Ensure response is an array so that we can safely call .map()
    const responseArray = Array.isArray(response) ? response : [response];

    // 5. Poll until the new contract appears in the database.
    const predicate = (results) =>
      results.filter((r) => r.status === rest.PENDING).length === 0;
    const action = async () =>
      rest.getBlocResults(
        token,
        responseArray.map((r) => r.hash),
        { config }
      );
    const finalResults = await util.until(predicate, action, { config }, 3600000);

    // Extract the deployed contract's address from the polling result.
    const deployedAddress = finalResults[0].data.contents.address;
    console.log(
      `New SimpleReserve contract deployed at address: ${deployedAddress}`
    );
  } catch (error) {
    console.error('Fatal error in deployment:', error);
  }
}

main();
