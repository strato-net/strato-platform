// Load environment variables from .env file.
require('dotenv').config();

const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');

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
    const { USERNAME, PASSWORD, OLD_RESERVE_ADDRESS } = process.env;

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

    // 2. Build call arguments for the 'deactivate' method.
    // Note: We only need to pass the contract's address.
    const callArgs = {
      contract: { address: OLD_RESERVE_ADDRESS },
      method: 'deactivate',
      // No arguments are required for 'deactivate'.
      args: util.usc({}),
    };

    console.log(
      `Calling 'deactivate' on reserve at address: ${OLD_RESERVE_ADDRESS}...`
    );
    const callResponse = await rest.call(token, callArgs, {
      config,
      cacheNonce: true,
      isAsync: true,
    });

    // Ensure callResponse is an array for polling.
    const responseArray = Array.isArray(callResponse)
      ? callResponse
      : [callResponse];

    // 3. Poll until the transaction call is confirmed.
    const predicate = (results) =>
      results.filter((r) => r.status === 'Pending').length === 0;
    const action = async (options) =>
      rest.getBlocResults(
        token,
        responseArray.map((r) => r.hash),
        options
      );
    const finalResults = await util.until(
      predicate,
      action,
      { config, isAsync: true },
      3600000
    );

    console.log(
      `Reserve at address ${OLD_RESERVE_ADDRESS} has been deactivated.`
    );
  } catch (error) {
    console.error('Fatal error in deactivating reserve:', error);
  }
}

main();
