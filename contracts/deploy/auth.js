/**
 * Authentication utilities for BlockApps
 */
const { rest, oauthUtil } = require('blockapps-rest');
const config = require('./config');

/**
 * Get a user token using username and password
 * @param {string} username - The username
 * @param {string} password - The password
 * @returns {Promise<string>} Access token
 */
async function getUserToken(username, password) {
  try {
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