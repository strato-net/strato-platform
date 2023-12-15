const { getEnvVariable } = require('./utils');

const MARKETPLACE_URL = getEnvVariable('MARKETPLACE_URL');

const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_PUBLISHABLE_KEY: getEnvVariable('STRIPE_PUBLISHABLE_KEY'),
    STRIPE_SECRET_KEY: getEnvVariable('STRIPE_SECRET_KEY'),
  },
  CHECKOUT: {
    PAYMENT_METHOD_TYPES: ['card'],
    SUCCESS_URL: `${MARKETPLACE_URL}/order/status?session_id={CHECKOUT_SESSION_ID}`,
    CANCEL_URL: `${MARKETPLACE_URL}/checkout`
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
    REFRESH_URL: `${MARKETPLACE_URL}/inventories/stripe/onboarding`,
    RETURN_URL: `${MARKETPLACE_URL}/inventories`
  }
}

module.exports.STRIPE_ENV = STRIPE_ENV;