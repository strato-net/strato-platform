/**
 * Authentication utilities for BlockApps
 */
const { rest, oauthUtil } = require('blockapps-rest');
const axios = require('axios');
const config = require('./config');

async function getUserTokenWithTotp(username, password, totp) {
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
    password,
    totp
  });

  if (process.env.OAUTH_SCOPE) {
    body.set('scope', process.env.OAUTH_SCOPE);
  }

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
    if (process.env.OAUTH_TOTP && process.env.OAUTH_TOTP.trim() !== '') {
      return getUserTokenWithTotp(username, password, process.env.OAUTH_TOTP.trim());
    }

    const oauth = await oauthUtil.init(config.nodes[0].oauth);
    const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
      username,
      password
    );
    const tokenField = config.nodes[0].oauth.tokenField || 'access_token';
    return tokenObj.token[tokenField];
  } catch (error) {
    console.error('Error getting user token:', error);
    throw error;
  }
}

/**
 * Get user info from token
 * @param {string} token - The access token
 * @returns {Promise<object>} User information
 */
async function getUserInfo(token) {
  try {
    const response = await rest.getStratoUserFromToken(token, { config });
    return response.user;
  } catch (error) {
    console.error('Error getting user info:', error);
    throw error;
  }
}

module.exports = {
  getUserToken,
  getUserInfo
};