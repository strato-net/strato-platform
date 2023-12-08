import { getEnvVariable } from 'helpers/utils'
import config from '/load.config'

export default {
  baseUrl: `/api/v1`,
  deployParamName: "deploy",
  governanceAddress: '0000000000000000000000000000000000000100',
  zeroAddress: '0000000000000000000000000000000000000000',
  certificateRegistryContractName: "OfficialCertificateRegistry",
  certificateContractName: "Certificate",
  emptyCert: '-----BEGIN CERTIFICATE-----\nMIIBVDCB+aADAgECAhBPjHUswOXtDsbDeQIsdepkMAwGCCqGSM49BAMCBQAwLDEJ\nMAcGA1UEAwwAMQkwBwYDVQQKDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMB4XDTIx\nMDUyNTE1MzQxNVoXDTIyMDUyNTE1MzQxNVowLDEJMAcGA1UEAwwAMQkwBwYDVQQK\nDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE\n4X1p4KE8cB6vYqKzSHIl+V5fDUC9p0j8OfOQOUhCfkjG1ALuRyP68tTohz9TLPLk\nYCVKrCiueuZJbejnGsp21TAMBggqhkjOPQQDAgUAA0gAMEUCIQCVtizg/N3MBdLi\nfHto7tqu1ia6cZpMI/G2bLWSPErK9AIgcBw+S8iVqSjh61CkgBAS066Z7M/W9eeY\n+sm9OKHDfQQ=\n-----END CERTIFICATE-----',
  testCert1: '-----BEGIN CERTIFICATE-----\nMIIB0jCCAXegAwIBAgIQeEdWygiiwHQ9e5bfkQVdVTAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYy\nMzg4NzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMTkxNTE2MzZaFw0yMjEwMTkxNTE2MzZaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYyMzg4\nNzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLsHOfw6jXFjQRAoLVDLwsmr\nKtHn5O6Cisa47lzxV0NfXVJXCcVP2N95GAB5/pmLsmE8rcdLQVBQFLWPjhGoCQ4w\nDAYIKoZIzj0EAwIFAANHADBEAiAChH6dQTLS/F/lNt7JkjMpC0uo6MEFI+zV5hCB\noNnc1gIgaMpLif4qKPRfAFjQJCJR8ORV1PEXf9xBK7XtPONqDQ0=\n-----END CERTIFICATE-----',
  testOrg1: '3ba304b8e87405bbf2388743b396a2813170c00f',
  testCert2: '-----BEGIN CERTIFICATE-----\nMIIB0zCCAXegAwIBAgIQJ23lFMdMW8pW7rJqMhAJ4jAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoNDYyNjVjZDI1NDc5YTkyNGM2\nOGFmMGU2NjczYTM3MWQ3MjhlNGVjZTEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMjAyMTU0NTNaFw0yMjEwMjAyMTU0NTNaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoNDYyNjVjZDI1NDc5YTkyNGM2OGFm\nMGU2NjczYTM3MWQ3MjhlNGVjZTEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLx+NgWTMaGUZjnwT4ZnIhU9\nDNZANA8A11BpHjNvVyx1TN+ftfN9FoLszHDg7Df8NbmCk/67eKkyES/jQn4QyAcw\nDAYIKoZIzj0EAwIFAANIADBFAiEAoCaNHm/M92/4P+BGwyV6z+aQ23eBTk7p9wKP\nE/rW7K4CIF8WMKJSZ4Sgyq2arDGuealfYGktGPibY0Wy0eCDzqlU\n-----END CERTIFICATE-----',
  testOrg2: '46265cd25479a924c68af0e6673a371d728e4ece',
  testOrg3: '642568b654ba679a9667e48615da02db4c21c6a5',
  searchLimit: 2000,
  EVENTS_GET_LIMIT: 3000,
  TOP_SELLING_GET_LIMIT: 3,
  tokenLifetimeReserveSeconds: 30,
  fileUploadFieldName: "fileUpload",
  s3ParamName: "s3",
  tempUploadDir: "./temp",
  buyerOrgName: "rejolut",
  sellerOrgName: "blockapps",
  assetTableName: "BlockApps-Mercata-Asset",
  saleTableName: "BlockApps-Mercata-Sale",
  orderTableName: "BlockApps-Mercata-Order",
};

export const STRIPE_ENV = {
  CREDENTIALS: {
    STRIPE_PUBLISHABLE_KEY: getEnvVariable("STRIPE_PUBLISHABLE_KEY"),
    STRIPE_SECRET_KEY: getEnvVariable("STRIPE_SECRET_KEY"),
  },
  CHECKOUT: {
    PAYMENT_METHOD_TYPES: ["card"],
    SUCCESS_URL: `${config.serverHost}${config.marketplaceUiUrlPrefix}/order/status?session_id={CHECKOUT_SESSION_ID}`,
    CANCEL_URL: `${config.serverHost}${config.marketplaceUiUrlPrefix}/checkout`
  },
  ACCOUNT_ONBOARDING: {
    TYPE: 'accountOnboarding',
    REFRESH_URL: `${config.serverHost}${config.marketplaceUiUrlPrefix}/inventories/stripe/onboarding`,
    RETURN_URL: `${config.serverHost}${config.marketplaceUiUrlPrefix}/inventories`
  }
}
Object.freeze(STRIPE_ENV)

export const unitOfMeasurement = {}
unitOfMeasurement[unitOfMeasurement['LB'] = 1] = 'LB';
unitOfMeasurement[unitOfMeasurement['OZ'] = 2] = 'OZ';
unitOfMeasurement[unitOfMeasurement['TON'] = 3] = 'TON';
unitOfMeasurement[unitOfMeasurement['BAG'] = 4] = 'BAG';
unitOfMeasurement[unitOfMeasurement['BOX'] = 5] = 'BOX';
unitOfMeasurement[unitOfMeasurement['PIECE'] = 6] = 'PIECE';
Object.freeze(unitOfMeasurement)


export const inventoryStatus = {}
inventoryStatus[inventoryStatus['PUBLISHED'] = 1] = 'PUBLISHED';
inventoryStatus[inventoryStatus['UNPUBLISHED'] = 2] = 'UNPUBLISHED';
Object.freeze(inventoryStatus)

export const CHARGES = {
  "SHIPPING": 0,
  "TAX": 0
}

export const ORDER_STATUS = {
  "AWAITING_FULFILLMENT": 1,
  "AWAITING_SHIPMENT": 2,
  "CLOSED": 3,
  "CANCELED": 4
}

export const ITEM_STATUS = {
  "PUBLISHED": 1,
  "UNPUBLISHED": 2,
  "REMOVED": 3,
  "SOLD": 4
}

export const PAYMENT_TYPES = {
  "card": "1",
  "strat": "2",
}

export const SERVICE_PROVIDERS = {}
SERVICE_PROVIDERS[SERVICE_PROVIDERS['STRIPE'] = 1] = 'STRIPE';
SERVICE_PROVIDERS[SERVICE_PROVIDERS['PAYPAL'] = 2] = 'PAYPAL';
Object.freeze(SERVICE_PROVIDERS)

