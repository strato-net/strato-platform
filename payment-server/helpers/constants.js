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

const STRIPE_CONTRACT_ADDRESS = process.env.STRIPE_CONTRACT_ADDRESS;
const METAMASK_CONTRACT_ADDRESS = process.env.METAMASK_CONTRACT_ADDRESS;
const REDEMPTION_CONTRACT_ADDRESS = process.env.REDEMPTION_CONTRACT_ADDRESS;

const SERVER_URL = `${config.serverHost}`;
const TABLE_PREFIX = `${process.env.TABLE_PREFIX ? process.env.TABLE_PREFIX : 'BlockApps-Mercata-'}`;

const SERVER_CONFIRM_URL = `${SERVER_URL}/stripe/checkout/confirm`;

const SERVER_CANCEL_URL = `${SERVER_URL}/stripe/checkout/cancel`;

const ASSET_LOCKED_EVENT_TABLE = `${TABLE_PREFIX}PaymentService.AssetLocked`;

const SELLER_ONBOARDED_TABLE = `${TABLE_PREFIX}PaymentService.SellerOnboarded`;

const PAYMENT_STATUS = {
  'INITIALIZED': '2',
  'PAID': '3',
  'CANCELED': '4',
  'DISCARDED': '5',
}

const PAYMENT_RECEIVED_MESSAGE = "Thank you for your payment.";

export { 
  STRIPE_ENV,
  SERVER_CONFIRM_URL,
  SERVER_CANCEL_URL,
  STRIPE_CONTRACT_ADDRESS,
  METAMASK_CONTRACT_ADDRESS,
  REDEMPTION_CONTRACT_ADDRESS,
  SERVER_URL,
  DEFAULT_OPTIONS,
  ASSET_LOCKED_EVENT_TABLE,
  SELLER_ONBOARDED_TABLE,
  PAYMENT_STATUS,
  TABLE_PREFIX,
  PAYMENT_RECEIVED_MESSAGE,
}
