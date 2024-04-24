import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);


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
  assetTableName: "Asset",
  saleTableName: "Sale",
  orderTableName: "Order",
  blockAppsOrg: "BlockApps",
  prodNetworkId: "6909499098523985262",
  testnetNetworkId: "7596898649924658542",
  prodStratsAddress: "b220195543f652f735b7847c4af399d0323e1ff6",
  testnetStratsAddress: "488cd3909d94606051e0684cf6caa5763fb78613",
  baUserNames: ['blockapps_carbon', 'blockapps_metals', 'blockapps_clothing', 'blockapps_collectibles', 'blockapps_memberships', 'blockapps_art'],
  localHost: 'http://localhost'
};

require('dotenv').config();
export const STRIPE_PAYMENT_SERVER_URL = process.env.STRIPE_PAYMENT_SERVER_URL;

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
  "amex": "1",
  "discover": "2",
  "mastercard": "3",
  "strat": "4",
  "visa": "5",
}

export const SERVICE_PROVIDERS = {}
SERVICE_PROVIDERS[SERVICE_PROVIDERS['STRIPE'] = 1] = 'STRIPE';
SERVICE_PROVIDERS[SERVICE_PROVIDERS['PAYPAL'] = 2] = 'PAYPAL';
Object.freeze(SERVICE_PROVIDERS)

// Helpers to calculate average price, range, units sold for Pirce History Stats
export const calculateAveragePrice = (records) => {
  const total = records.reduce((sum, record) => sum + Number(record.price), 0);
  return (total / records.length).toFixed(2);
}


export const calculatePriceFluctuation =(records)=> {
  const prices = records.map(record => record.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export const calculateVolumeTraded = (records) => {
  return records.reduce((acc, record, index, array) => {
    // Skip the first element as there's no previous element to compare with
    if (index === 0) return acc;

    // Check if the current record and the previous record have the same address
    // We shouldn't track quantity decreased for a new sale contract created
    // (when user uses list for sale) as the lesser quantity can be listed for sale 
    if (record.address === array[index - 1].address) {
      const quantityDecrease = array[index - 1].quantity - record.quantity;

      // Only add to the accumulator if there's a decrease in quantity
      if (quantityDecrease > 0) {
        acc += quantityDecrease;
      }
    }

    return acc;
  }, 0);
};


// Helpers to get time `x` months/years ago and date
export const getOneYearAgoTime =()=>{
  const time = dayjs().utc().subtract(1, 'year').format('YYYY-MM-DD HH:mm:ss') + ' UTC';
  return time;
}
export const getSixMonthsAgoTime =()=>{
  const time = dayjs().utc().subtract(6, 'months').format('YYYY-MM-DD HH:mm:ss') + ' UTC';
  return time;
}
export const getDate = (record) =>{
  const date = dayjs(record.block_timestamp).format('YYYY-MM-DD');
  return date;
}

//Helpers for timeFilter
export const timeFilterForSixMonths = () =>{
  return '1';
}
export const timeFilterForOneYear = () =>{
  return '2';
}
export const timeFilterForAll = () =>{
  return '3';
}