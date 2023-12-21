const { getEnvVariable } = require('./utils');

const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_PUBLISHABLE_KEY: getEnvVariable('STRIPE_PUBLISHABLE_KEY'),
    STRIPE_SECRET_KEY: getEnvVariable('STRIPE_SECRET_KEY'),
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
  }
}

module.exports.STRIPE_ENV = STRIPE_ENV;