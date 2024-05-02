import oauthHelper from "./oauthHelper.js"

const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
  }
}

const TOKEN_LIFETIME_RESERVE_SECONDS = 30;

const ADMIN = async () => {
  let serviceUserToken
  try {
    serviceUserToken = await oauthHelper.getServiceToken()
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

export { STRIPE_ENV, ADMIN, TOKEN_LIFETIME_RESERVE_SECONDS }
