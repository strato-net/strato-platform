const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
  }
}

module.exports.STRIPE_ENV = STRIPE_ENV;
