import OAuthUtil from "./oauth";
import { config } from "../config";
import { logError } from "../utils/logger";
import { strato } from "../utils/api";


type AuthRole = "operator" | "relayer";

const getIdentityConfig = (role: AuthRole) =>
  role === "operator" ? config.auth : config.relayerAuth;

const getOAuthConfig = (role: AuthRole) => {
  const identity = getIdentityConfig(role);
  if (
    !identity.clientId ||
    !identity.clientSecret ||
    !identity.openIdDiscoveryUrl
  ) {
    throw new Error(`${role} OAuth client configuration is incomplete`);
  }
  return {
    clientId: identity.clientId,
    clientSecret: identity.clientSecret,
    openIdDiscoveryUrl: identity.openIdDiscoveryUrl,
    scope: "openid email profile",
    tokenField: "access_token",
  };
};

interface TokenData {
  token: string;
  expiresAt: number;
}

const cachedTokens: Partial<Record<AuthRole, TokenData>> = {};

let cachedUserAddress: string | null = null;

// Promise deduplication: concurrent callers share one in-flight request
const tokenRefreshPromises: Partial<Record<AuthRole, Promise<string>>> = {};
let addressPromise: Promise<string> | null = null;

const TOKEN_LIFETIME_THRESHOLD_SECONDS = 10;

// Add singleton pattern for OAuth initialization
let oauthInitialized = false;
const oauthInstances: Partial<Record<AuthRole, any>> = {};

export const initOpenIdConfig = async () => {
  // If already initialized, return immediately
  if (oauthInitialized) {
    console.log(`[Auth] OAuth already initialized, skipping`);
    return;
  }

  try {
    await Promise.all(
      (["operator", "relayer"] as AuthRole[]).map(async (role) => {
        const identity = getIdentityConfig(role);
        console.log(`[Auth] Initializing ${role} OAuth`, {
          clientId: identity.clientId,
          openIdDiscoveryUrl: identity.openIdDiscoveryUrl,
          hasUsername: !!identity.baUsername,
          hasPassword: !!identity.baPassword,
        });
        oauthInstances[role] = await OAuthUtil.init(getOAuthConfig(role));
      }),
    );

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

const getToken = async (role: AuthRole): Promise<string> => {
  const identity = getIdentityConfig(role);
  if (!identity.baUsername || !identity.baPassword) {
    throw new Error(`${role} resource-owner credentials are incomplete`);
  }
  const userTokenData = cachedTokens[role];
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if a valid cached token exists
  if (
    userTokenData &&
    userTokenData.token &&
    userTokenData.expiresAt > currentTime + TOKEN_LIFETIME_THRESHOLD_SECONDS
  ) {
    return userTokenData.token;
  }

  // Deduplicate concurrent refresh requests
  if (tokenRefreshPromises[role]) {
    return tokenRefreshPromises[role]!;
  }

  tokenRefreshPromises[role] = (async () => {
    try {
      const oauthInstance = oauthInstances[role];
      if (!oauthInstance) {
        throw new Error(
          "OAuth client not initialized. Call initOpenIdConfig() first",
        );
      }

      const tokenObj =
        await oauthInstance.getAccessTokenByResourceOwnerCredential(
          identity.baUsername,
          identity.baPassword,
        );

      const token = tokenObj.token[getOAuthConfig(role).tokenField] as string;
      const expiresAt = tokenObj.token.expires_at as number;
      cachedTokens[role] = { token, expiresAt };

      return token;
    } catch (error: any) {
      console.error(`[Auth] ${role} token error:`, {
        errorMessage: error?.message,
        errorName: error?.name,
        errorStack: error?.stack,
        hasOAuthInstance: !!oauthInstances[role],
        hasPassword: !!identity.baPassword,
        username: identity.baUsername,
      });

      throw new Error(
        `Failed to fetch ${role} OAuth token: ${error?.message || "Unknown error"}`,
      );
    } finally {
      delete tokenRefreshPromises[role];
    }
  })();

  return tokenRefreshPromises[role]!;
};

export const getBAUserToken = (): Promise<string> => getToken("operator");

export const getRelayerToken = (): Promise<string> => getToken("relayer");

export const getBAUserAddress = async (): Promise<string> => {
  if (cachedUserAddress) {
    return cachedUserAddress;
  }

  // Deduplicate concurrent address requests
  if (addressPromise) {
    return addressPromise;
  }

  addressPromise = (async () => {
    try {
      const response = await strato.get('/key');
      cachedUserAddress = response.address;
      return cachedUserAddress!;
    } catch (error: any) {
      throw new Error(
        `Failed to fetch user address: ${error?.message || "Unknown error"}`,
      );
    } finally {
      addressPromise = null;
    }
  })();

  return addressPromise;
};
