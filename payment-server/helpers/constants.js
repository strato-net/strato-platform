import config from '../load.config.js';

const OPTIONS = { config };

const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
  }
}

const DEFAULT_OPTIONS = { ...OPTIONS, chainIds: [], cacheNonce: true };

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const SERVER_URL = `${process.env.SERVER_HOST}:${process.env.PORT ? process.env.PORT : 8018}`;

const CLIENT_URL = `${process.env.SERVER_HOST}:${process.env.CLIENT_PORT ? process.env.CLIENT_PORT : 8020}`;

const SERVER_CONFIRM_URL = `${SERVER_URL}/stripe/checkout/confirm`;

const SERVER_CANCEL_URL = `${SERVER_URL}/stripe/checkout/cancel`;

export { 
  STRIPE_ENV,
  SERVER_CONFIRM_URL,
  SERVER_CANCEL_URL,
  CONTRACT_ADDRESS,
  SERVER_URL,
  CLIENT_URL,
  DEFAULT_OPTIONS,
}
