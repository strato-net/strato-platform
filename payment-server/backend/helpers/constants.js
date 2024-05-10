import config from "../load.config.js";
import oauthHelper from "./oauthHelper.js";

const options = { config, logger: console };

const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
  }
}

const TOKEN_LIFETIME_RESERVE_SECONDS = 300;

const bootStrapAdmin = async () => {
  let serviceUserToken
  try {
    serviceUserToken = await oauthHelper.getServiceToken();
  } catch(e) {
    console.error("ERROR: Unable to fetch the service user token, check your OAuth settings in config", e);
    throw e;
  }
  const adminCredentials = { token: serviceUserToken };
  const adminEmail = oauthHelper.getEmailIdFromToken(adminCredentials.token);
  console.log("Creating Admin...", adminEmail);
  const adminResponse = await oauthHelper.createStratoUser(
    adminCredentials,
    adminEmail
  );
  if (adminResponse.status === 200) {
    console.log("Admin successfully created!");
    return adminResponse.user;
  } else {
    throw new Error(`Admin was not created/does not exist. Please check your credential setup.`);
  }
}

const ADMIN = await bootStrapAdmin();

const DEFAULT_OPTIONS = { ...options, chainIds: [], cacheNonce: true };

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const SERVER_URL = `${process.env.SERVER_HOST}:${process.env.PORT ? process.env.PORT : 8018}`;

const CLIENT_URL = `${process.env.SERVER_HOST}:${process.env.CLIENT_PORT ? process.env.CLIENT_PORT : 8020}`;

const CHECKOUT_URL = `${CLIENT_URL}/stripe/checkout/confirm`;

export { 
  STRIPE_ENV, 
  ADMIN, 
  TOKEN_LIFETIME_RESERVE_SECONDS,
  CHECKOUT_URL,
  CONTRACT_ADDRESS,
  SERVER_URL,
  CLIENT_URL,
  DEFAULT_OPTIONS,
}
