/**
 * Authentication utilities for BlockApps
 */
const axios = require('axios');
const config = require('./config');

async function getUserTokenFromCredentials(username, password, totp) {
  const oauthConfig = config.nodes[0].oauth;
  const discovery = await axios.get(oauthConfig.openIdDiscoveryUrl);
  const tokenEndpoint = discovery.data && discovery.data.token_endpoint;

  if (!tokenEndpoint) {
    throw new Error(`OAuth discovery document missing token_endpoint: ${oauthConfig.openIdDiscoveryUrl}`);
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    username,
    password
  });

  if (totp) body.set('totp', totp);

  body.set('scope', process.env.OAUTH_SCOPE || oauthConfig.scope || 'email openid');

  const response = await axios.post(tokenEndpoint, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  const tokenField = oauthConfig.tokenField || 'access_token';
  return response.data && response.data[tokenField];
}

/**
 * Get a user token using username and password
 * @param {string} username - The username
 * @param {string} password - The password
 * @returns {Promise<string>} Access token
 */
async function getUserToken(username, password) {
  try {
    return await getUserTokenFromCredentials(username, password, process.env.OAUTH_TOTP?.trim());
  } catch (error) {
    console.error('Error getting user token:', error);
    throw error;
  }
}

module.exports = {
  getUserToken
};
