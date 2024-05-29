import config from '../load.config.js'

const OPTIONS = { config };

const DEFAULT_OPTIONS = { ...OPTIONS, chainIds: [], cacheNonce: true };
const PAYMENT_EVENT_TABLE = 'BlockApps-Mercata-PaymentService.Payment';

const PAYMENT_STATUS = {
  'INITIALIZED': '2',
  'PAID': '3',
  'CANCELED': '4',
}

export {
    DEFAULT_OPTIONS,
    PAYMENT_EVENT_TABLE,
    PAYMENT_STATUS
}