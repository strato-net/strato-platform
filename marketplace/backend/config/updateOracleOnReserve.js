require('dotenv').config();
const { rest, util, fsUtil, oauthUtil } = require('blockapps-rest');
const config = fsUtil.getYaml(`../config.yaml`);

/**
 * Obtains a user token using OAuth resource owner credentials.
 *
 * @param {string} username - The username.
 * @param {string} password - The password.
 * @param {object|null} req - (Optional) Request object.
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

/**
 * Helper function to call a contract method and poll until completion.
 *
 * @param {Object} token - The token object.
 * @param {Object} callArgs - The call arguments.
 * @returns {Promise<Object>} - The final result of the call.
 */
const callAndWait = async (token, callArgs) => {
  const options = { config, cacheNonce: true, isAsync: true };
  const callResponse = await rest.call(token, callArgs, options);
  const responseArray = Array.isArray(callResponse)
    ? callResponse
    : [callResponse];
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
  return finalResults;
};

/**
 * Updates the oracle for a given reserve by calling its setOracle method.
 *
 * @param {string} reserveAddress - The address of the reserve.
 * @param {string} newOracleAddress - The new oracle address.
 * @param {Object} token - The token object.
 */
const updateOracle = async (reserveAddress, newOracleAddress, token) => {
  const callArgs = {
    contract: { address: reserveAddress },
    method: 'setOracle',
    args: util.usc({
      newOracle: newOracleAddress,
    }),
  };

  console.log(
    `Updating oracle for reserve ${reserveAddress} to ${newOracleAddress}...`
  );
  const finalResults = await callAndWait(token, callArgs);
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== 'Success') {
    throw new Error(`Failed to update oracle for reserve ${reserveAddress}.`);
  }
  console.log(
    `Oracle for reserve ${reserveAddress} updated to ${newOracleAddress}.`
  );
};

async function main() {
  try {
    // Validate required environment variables.
    const { USERNAME, PASSWORD, ORACLE_ADDRESS, NEW_RESERVE_ADDRESS } =
      process.env;
    if (!USERNAME || !PASSWORD)
      throw new Error('USERNAME and PASSWORD are required.');
    if (!ORACLE_ADDRESS) throw new Error('ORACLE is required.');
    if (!NEW_RESERVE_ADDRESS)
      throw new Error('NEW_RESERVE_ADDRESS is required.');

    // Obtain the user token via OAuth.
    const tokenString = await getUserToken(USERNAME, PASSWORD);
    if (!tokenString) throw new Error('Failed to acquire token.');
    console.log('Token acquired:', tokenString);
    const token = { token: tokenString };

    // Fetch active reserves.
    const reserveQuery = {
      config,
      query: {
        isActive: 'eq.true',
        creator: 'eq.BlockApps',
        address: `eq.${NEW_RESERVE_ADDRESS}`,
      },
    };
    const reserves = await rest.search(
      token,
      { name: 'BlockApps-Mercata-Reserve' },
      reserveQuery
    );
    if (!reserves || reserves.length === 0) {
      console.log('No active reserves found.');
      return;
    }
    const reserve = reserves[0];

    // Process each reserve individually.
    await updateOracle(reserve.address, ORACLE_ADDRESS, token);
  } catch (error) {
    console.error('Error updating reserves:', error);
  }
}

main();
