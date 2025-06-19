const {
  baUsername,
  baPassword,
  testnetClientSecret,
  prodClientSecret,
  NODE_ENV,
  CLIENT_ID
} = require("../config");
const { oauthUtil } = require("blockapps-rest");

// OAuth configuration
const oauthInit = {
  appTokenCookieName: "asset_framework_session",
  appTokenCookieMaxAge: 7776000000,
  openIdDiscoveryUrl: `https://keycloak.blockapps.net/auth/realms/${
    NODE_ENV === "prod" ? "mercata" : "mercata-testnet2"
  }/.well-known/openid-configuration`,
  clientId: CLIENT_ID,
  clientSecret: NODE_ENV === "prod" ? prodClientSecret : testnetClientSecret,
  scope: "email openid",
  serviceOAuthFlow: null,
  redirectUri: "http://localhost/api/v1/authentication/callback",
  logoutRedirectUri: "http://localhost",
  tokenField: "access_token",
  tokenUsernameProperty: null,
  tokenUsernamePropertyServiceFlow: null,
};

const CACHED_DATA = {
  serviceToken: null,
  serviceTokenExpiresAt: null,
};

const TOKEN_LIFETIME_RESERVE_SECONDS = 120; // Reserve 2 minutes for token expiration check

/**
 * Retrieves the user token, either from cache or by requesting a new one.
 * @returns {Promise<string>} - The OAuth token
 * @throws Will throw an error if the token retrieval process fails.
 */
const getUserToken = async () => {
  const cacheKey = baUsername;
  const userTokenData = CACHED_DATA[cacheKey];
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if a valid cached token exists
  if (
    userTokenData &&
    userTokenData.token &&
    userTokenData.expiresAt > currentTime + TOKEN_LIFETIME_RESERVE_SECONDS
  ) {
    console.log("Returning cached token");
    return userTokenData.token;
  }

  try {
    // Initialize OAuth only if no valid cached token is available
    const oauth = await oauthUtil.init(oauthInit);

    // Fetch a new token using Resource Owner Password Credentials
    const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
      baUsername,
      baPassword
    );
    const token = tokenObj.token[oauthInit.tokenField];
    const expiresAt = Math.floor(tokenObj.token.expires_at / 1000);
    console.log("New OAuth token expires at:", new Date(expiresAt * 1000));
    // Cache the new token
    CACHED_DATA[cacheKey] = { token, expiresAt };

    console.log("Returning new OAuth token");
    return token;
  } catch (error) {
    console.error("Error fetching user OAuth token:", error);
    throw new Error("Failed to fetch user OAuth token");
  }
};

module.exports = { getUserToken };
