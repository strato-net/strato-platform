import OAuthUtil from "./oauth";
import { config } from "../config";
import { logError } from "../utils/logger";
import { strato } from "../utils/api";

const validateConfig = () => {
  if (!config.auth?.clientId) {
    throw new Error("CLIENT_ID is not configured");
  }
  if (!config.auth?.clientSecret) {
    throw new Error("CLIENT_SECRET is not configured");
  }
  if (!config.auth?.openIdDiscoveryUrl) {
    throw new Error("OPENID_DISCOVERY_URL is not configured");
  }
};

const getOAuthConfig = () => {
  validateConfig();
  return {
    clientId: config.auth.clientId!,
    clientSecret: config.auth.clientSecret!,
    openIdDiscoveryUrl: config.auth.openIdDiscoveryUrl!,
    scope: "openid email profile",
    tokenField: "access_token",
  };
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

let cachedUserAddress: string | null = null;

const TOKEN_LIFETIME_THRESHOLD_SECONDS = 10;

let oauthInitialized = false;
let oauthInstance: any = null;

export const initOpenIdConfig = async () => {
  if (oauthInitialized) {
    console.log(`[Auth] OAuth already initialized, skipping`);
    return;
  }

  try {
    console.log(`[Auth] Initializing OAuth with config:`, {
      clientId: config.auth.clientId,
      hasClientSecret: !!config.auth.clientSecret,
      openIdDiscoveryUrl: config.auth.openIdDiscoveryUrl,
      hasUsername: !!config.auth.baUsername,
      hasPassword: !!config.auth.baPassword
    });
    
    oauthInstance = await OAuthUtil.init(getOAuthConfig());
    oauthInitialized = true;
    
    console.log(`[Auth] OAuth initialization completed successfully`);
  } catch (error) {
    console.error(`[Auth] OAuth initialization failed:`, {
      errorMessage: (error as Error)?.message,
      errorName: (error as Error)?.name,
      errorStack: (error as Error)?.stack
    });
    
    logError("Auth", error as Error, { operation: "initOpenIdConfig" });
    throw error;
  }
};

export const getBAUserToken = async (): Promise<string> => {
  if (!config.auth.baUsername) {
    throw new Error("BA_USERNAME is not configured");
  }

  const cacheKey = config.auth.baUsername;
  const userTokenData = CACHED_DATA[cacheKey];
  const currentTime = Math.floor(Date.now() / 1000);

  if (
    userTokenData &&
    userTokenData.token &&
    userTokenData.expiresAt > currentTime + TOKEN_LIFETIME_THRESHOLD_SECONDS
  ) {
    return userTokenData.token;
  }

  try {
    if (!oauthInstance) {
      throw new Error(
        "OAuth client not initialized. Call initOpenIdConfig() first",
      );
    }

    if (!config.auth.baPassword) {
      throw new Error("BA_PASSWORD is not configured");
    }

    const tokenObj =
      await oauthInstance.getAccessTokenByResourceOwnerCredential(
        config.auth.baUsername,
        config.auth.baPassword,
      );

    const token = tokenObj.token[getOAuthConfig().tokenField] as string;
    const expiresAt = tokenObj.token.expires_at as number;

    CACHED_DATA[cacheKey] = { token, expiresAt };
    
    return token;
  } catch (error: any) {
    console.error(`[Auth] getBAUserToken error:`, {
      errorMessage: error?.message,
      errorName: error?.name,
      errorStack: error?.stack,
      hasOAuthInstance: !!oauthInstance,
      hasPassword: !!config.auth.baPassword,
      username: config.auth.baUsername
    });
    
    throw new Error(
      `Failed to fetch user OAuth token: ${error?.message || "Unknown error"}`,
    );
  }
};

export const getBAUserAddress = async (): Promise<string> => {
  if (cachedUserAddress) {
    return cachedUserAddress;
  }

  try {
    const response = await strato.get('/key');
    cachedUserAddress = response.address;
    return cachedUserAddress!;
  } catch (error: any) {
    throw new Error(
      `Failed to fetch user address: ${error?.message || "Unknown error"}`,
    );
  }
};

