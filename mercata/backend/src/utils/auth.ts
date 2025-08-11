import { authConfig } from '../config/auth.config';
import OAuthUtil from './oauth';

// OAuth configuration
if (!authConfig.clientId) {
  throw new Error('CLIENT_ID is not configured');
}
if (!authConfig.clientSecret) {
  throw new Error('CLIENT_SECRET is not configured');
}
if (!authConfig.openIdDiscoveryUrl) {
  throw new Error('OPENID_DISCOVERY_URL is not configured');
}

const oauthConfig = {
  clientId: authConfig.clientId,
  clientSecret: authConfig.clientSecret,
  openIdDiscoveryUrl: authConfig.openIdDiscoveryUrl,
  scope: "openid email profile",
  tokenField: "access_token"
};

interface TokenData {
  token: string;
  expiresAt: number;
}

const CACHED_DATA: {
  [key: string]: TokenData | null;
} = {
  serviceToken: null,
};

const TOKEN_LIFETIME_RESERVE_SECONDS = 120; // Reserve 2 minutes for token expiration check

// Add singleton pattern for OAuth initialization
let oauthInitialized = false;
let oauthInstance: any = null;

export const initOpenIdConfig = async () => {
  // If already initialized, return immediately
  if (oauthInitialized) {
    return;
  }

  try {
    oauthInstance = await OAuthUtil.init(oauthConfig);
    oauthInitialized = true;
  } catch (error) {
    console.error("❌ Failed to initialize OAuth client:", error);
    throw error;
  }
};

export const getBAUserToken = async (): Promise<string> => {
  if (!authConfig.baUsername) {
    throw new Error('BA_USERNAME is not configured');
  }

  const cacheKey = authConfig.baUsername;
  const userTokenData = CACHED_DATA[cacheKey];
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if a valid cached token exists
  if (
    userTokenData &&
    userTokenData.token &&
    userTokenData.expiresAt > currentTime + TOKEN_LIFETIME_RESERVE_SECONDS
  ) {
    return userTokenData.token;
  }

  try {
    if (!oauthInstance) {
      throw new Error('OAuth client not initialized. Call initOpenIdConfig() first');
    }

    if (!authConfig.baPassword) {
      throw new Error('BA_PASSWORD is not configured');
    }

    // Fetch a new token using Resource Owner Password Credentials
    const tokenObj = await oauthInstance.getAccessTokenByResourceOwnerCredential(
      authConfig.baUsername,
      authConfig.baPassword
    );

    // Type assertion for token object
    const token = tokenObj.token[oauthConfig.tokenField] as string;
    const expiresAt = Math.floor((tokenObj.token.expires_at as number) / 1000);
    
    // Cache the new token
    CACHED_DATA[cacheKey] = { token, expiresAt };
    return token;
  } catch (error: any) {
    throw new Error(`Failed to fetch user OAuth token: ${error?.message || 'Unknown error'}`);
  }
}; 