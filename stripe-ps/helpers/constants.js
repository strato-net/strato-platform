const { getEnvVariable } = require('./utils');

const MARKETPLACE_URL = getEnvVariable('MARKETPLACE_URL');

const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_PUBLISHABLE_KEY: getEnvVariable('STRIPE_PUBLISHABLE_KEY'),
    STRIPE_SECRET_KEY: getEnvVariable('STRIPE_SECRET_KEY'),
  },
  CHECKOUT: {
    PAYMENT_METHOD_TYPES: ['card'],
    SUCCESS_URL: new URL(`/order/status?session_id={CHECKOUT_SESSION_ID}`, MARKETPLACE_URL).href,
    CANCEL_URL: new URL(`/checkout`, MARKETPLACE_URL).href
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
    REFRESH_URL: new URL(`/inventories/stripe/onboarding`, MARKETPLACE_URL).href,
    RETURN_URL: new URL(`/inventories`, MARKETPLACE_URL).href
  }
}

module.exports.STRIPE_ENV = STRIPE_ENV;
