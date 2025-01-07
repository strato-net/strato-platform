import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

export default {
  baseUrl: `/api/v1`,
  deployParamName: 'deploy',
  reserve: '0000000000000000000000000000000000000100',
  zeroAddress: '0000000000000000000000000000000000000000',
  certificateRegistryContractName: 'OfficialCertificateRegistry',
  certificateContractName: 'Certificate',
  userContractName: 'BlockApps-UserRegistry-User',
  mercataAdminContractName: 'MercataAdmin',
  emptyCert:
    '-----BEGIN CERTIFICATE-----\nMIIBVDCB+aADAgECAhBPjHUswOXtDsbDeQIsdepkMAwGCCqGSM49BAMCBQAwLDEJ\nMAcGA1UEAwwAMQkwBwYDVQQKDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMB4XDTIx\nMDUyNTE1MzQxNVoXDTIyMDUyNTE1MzQxNVowLDEJMAcGA1UEAwwAMQkwBwYDVQQK\nDAAxCTAHBgNVBAsMADEJMAcGA1UEBgwAMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAE\n4X1p4KE8cB6vYqKzSHIl+V5fDUC9p0j8OfOQOUhCfkjG1ALuRyP68tTohz9TLPLk\nYCVKrCiueuZJbejnGsp21TAMBggqhkjOPQQDAgUAA0gAMEUCIQCVtizg/N3MBdLi\nfHto7tqu1ia6cZpMI/G2bLWSPErK9AIgcBw+S8iVqSjh61CkgBAS066Z7M/W9eeY\n+sm9OKHDfQQ=\n-----END CERTIFICATE-----',
  testCert1:
    '-----BEGIN CERTIFICATE-----\nMIIB0jCCAXegAwIBAgIQeEdWygiiwHQ9e5bfkQVdVTAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYy\nMzg4NzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMTkxNTE2MzZaFw0yMjEwMTkxNTE2MzZaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoM2JhMzA0YjhlODc0MDViYmYyMzg4\nNzQzYjM5NmEyODEzMTcwYzAwZjEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLsHOfw6jXFjQRAoLVDLwsmr\nKtHn5O6Cisa47lzxV0NfXVJXCcVP2N95GAB5/pmLsmE8rcdLQVBQFLWPjhGoCQ4w\nDAYIKoZIzj0EAwIFAANHADBEAiAChH6dQTLS/F/lNt7JkjMpC0uo6MEFI+zV5hCB\noNnc1gIgaMpLif4qKPRfAFjQJCJR8ORV1PEXf9xBK7XtPONqDQ0=\n-----END CERTIFICATE-----',
  testOrg1: '3ba304b8e87405bbf2388743b396a2813170c00f',
  testCert2:
    '-----BEGIN CERTIFICATE-----\nMIIB0zCCAXegAwIBAgIQJ23lFMdMW8pW7rJqMhAJ4jAMBggqhkjOPQQDAgUAMGsx\nEjAQBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoNDYyNjVjZDI1NDc5YTkyNGM2\nOGFmMGU2NjczYTM3MWQ3MjhlNGVjZTEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAK\nBgNVBAYMA1VTQTAeFw0yMTEwMjAyMTU0NTNaFw0yMjEwMjAyMTU0NTNaMGsxEjAQ\nBgNVBAMMCUJsb2NrQXBwczExMC8GA1UECgwoNDYyNjVjZDI1NDc5YTkyNGM2OGFm\nMGU2NjczYTM3MWQ3MjhlNGVjZTEUMBIGA1UECwwLZW5naW5lZXJpbmcxDDAKBgNV\nBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABLx+NgWTMaGUZjnwT4ZnIhU9\nDNZANA8A11BpHjNvVyx1TN+ftfN9FoLszHDg7Df8NbmCk/67eKkyES/jQn4QyAcw\nDAYIKoZIzj0EAwIFAANIADBFAiEAoCaNHm/M92/4P+BGwyV6z+aQ23eBTk7p9wKP\nE/rW7K4CIF8WMKJSZ4Sgyq2arDGuealfYGktGPibY0Wy0eCDzqlU\n-----END CERTIFICATE-----',
  testOrg2: '46265cd25479a924c68af0e6673a371d728e4ece',
  testOrg3: '642568b654ba679a9667e48615da02db4c21c6a5',
  searchLimit: 2000,
  EVENTS_GET_LIMIT: 3000,
  TOP_SELLING_GET_LIMIT: 3,
  tokenLifetimeReserveSeconds: 30,
  fileUploadFieldName: 'fileUpload',
  s3ParamName: 's3',
  tempUploadDir: './temp',
  buyerOrgName: 'rejolut',
  sellerOrgName: 'blockapps',
  assetTableName: 'Asset',
  saleTableName: 'Sale',
  orderTableName: 'Order',
  blockAppsOrg: 'BlockApps',
  prodNetworkId: '6909499098523985262',
  testnetNetworkId: '7596898649924658542',
  prodStratsAddress: 'd2810818e0401e85693f83107ed2b96faeed329c',
  testnetStratsAddress: '5375b8b1c691201acf16a72612d82ed438951a04',
  prodUSDSTAddress: '',
  testnetUSDSTAddress: 'bbb0e060f3f43c533d5b5f0250ff473de831e5e4',
  prodCataAddress: '2680dc6693021cd3fefb84351570874fbef8332a',
  testnetCataAddress: '051cb99bca7c437f4b17dc01bd4ff7c5e09db035',
  testnetETHSTAddress: '921e3d0b4217c7e2bfe7e660cdc4f7edc621f9d5',
  prodETHSTAddress: '93fb7295859b2d70199e0a4883b7c320cf874e6c',
  attachImagesAndFiles:
    '*,BlockApps-Mercata-Asset-files(*),BlockApps-Mercata-Asset-images(*),BlockApps-Mercata-Asset-fileNames(*)',
  attachSalesAndImagesAndFiles:
    '*,BlockApps-Mercata-Asset-files(*),BlockApps-Mercata-Asset-images(*),BlockApps-Mercata-Asset-fileNames(*),BlockApps-Mercata-Sale!BlockApps-Mercata-Sale_BlockApps-Mercata-Asset_fk(*,BlockApps-Mercata-Sale-paymentServices(*))',
  attachSalesEscrowsAndImagesAndFiles:
    '*,BlockApps-Mercata-Asset-files(*),BlockApps-Mercata-Asset-images(*),BlockApps-Mercata-Asset-fileNames(*),BlockApps-Mercata-Sale!BlockApps-Mercata-Sale_BlockApps-Mercata-Asset_fk(*,BlockApps-Mercata-Sale-paymentServices(*)),BlockApps-Mercata-Escrow-assets!BlockApps-Mercata-Escrow-assets_BlockApps-Mercata-Asset_fk(*,BlockApps-Mercata-Escrow(*))',
  attach_saleAddresses_Quantities_completedSales_onOrder:
    '*,BlockApps-Mercata-Order-saleAddresses(*),BlockApps-Mercata-Order-quantities(*),BlockApps-Mercata-Order-completedSales(*)',
  baUserNames: [
    'blockapps_carbon',
    'blockapps_metals',
    'blockapps_clothing',
    'blockapps_collectibles',
    'blockapps_memberships',
    'blockapps_art',
    'blockapps_spirits',
  ],
  AssetsWithEighteenDecimalPlaces: [
    '2680dc6693021cd3fefb84351570874fbef8332a', //prodCataAddress
    '051cb99bca7c437f4b17dc01bd4ff7c5e09db035', //testnetCataAddress
    '93fb7295859b2d70199e0a4883b7c320cf874e6c', //prodETHSTAddress
    '921e3d0b4217c7e2bfe7e660cdc4f7edc621f9d5', //testnetETHSTAddress
    '76372ee8d5a47c58cee4b0e63400858cf4f9ef13', //testnetBETHTEMP
    '7f5c102390240f4a8f0e0d938d341bf1e3010adc', //testnetUSDTEMP
    'd6e292f2c9486ada24f6d5cf2e67f44c5f7f677a', //prodBETHTEMP
    '04d68c24ff359ab457c7b96810f85c51989fe8ed', //prodUSDTEMP
    'bbb0e060f3f43c533d5b5f0250ff473de831e5e4', //testnetUSDSTAddress
  ],
  localHost: 'http://localhost',
  burnAddress: '6ec8bbe4a5b87be18d443408df43a45e5972fa1b',
  testTokenServerUrl: 'https://campaigns-test.blockapps.net',
  prodTokenServerUrl: 'https://campaigns.blockapps.net',
};

export const unitOfMeasurement = {};
unitOfMeasurement[(unitOfMeasurement['LB'] = 1)] = 'LB';
unitOfMeasurement[(unitOfMeasurement['OZ'] = 2)] = 'OZ';
unitOfMeasurement[(unitOfMeasurement['TON'] = 3)] = 'TON';
unitOfMeasurement[(unitOfMeasurement['BAG'] = 4)] = 'BAG';
unitOfMeasurement[(unitOfMeasurement['BOX'] = 5)] = 'BOX';
unitOfMeasurement[(unitOfMeasurement['PIECE'] = 6)] = 'PIECE';
Object.freeze(unitOfMeasurement);

export const inventoryStatus = {};
inventoryStatus[(inventoryStatus['PUBLISHED'] = 1)] = 'PUBLISHED';
inventoryStatus[(inventoryStatus['UNPUBLISHED'] = 2)] = 'UNPUBLISHED';
Object.freeze(inventoryStatus);

export const CHARGES = {
  SHIPPING: 0,
  TAX: 0,
};

export const ASSET_STATUS = {
  ACTIVE: 1,
  PENDING_REDEMPTION: 2,
  RETIRED: 3,
};

export const REDEMPTION_STATUS = {
  PENDING: 1,
  FULFILLED: 2,
  REJECTED: 3,
};

export const ORDER_STATUS = {
  AWAITING_FULFILLMENT: 1,
  AWAITING_SHIPMENT: 2,
  CLOSED: 3,
  CANCELED: 4,
};

export const ITEM_STATUS = {
  PUBLISHED: 1,
  UNPUBLISHED: 2,
  REMOVED: 3,
  SOLD: 4,
};

export const ISSUER_STATUS = {
  UNAUTHORIZED: '1',
  PENDING_REVIEW: '2',
  AUTHORIZED: '3',
};

// Orders: No comments initially
export const DEFAULT_COMMENT = '';

export const SERVICE_PROVIDERS = {};
SERVICE_PROVIDERS[(SERVICE_PROVIDERS['STRIPE'] = 1)] = 'STRIPE';
SERVICE_PROVIDERS[(SERVICE_PROVIDERS['PAYPAL'] = 2)] = 'PAYPAL';
Object.freeze(SERVICE_PROVIDERS);

export const calculateAverageSalePrice = (records) => {
  // Track the last seen effective quantity (quantity + totalLockedQuantity)
  const lastSeenEffectiveQuantities = {};

  // Filter records where the effective purchase quantity decreases
  const filteredRecords = records.filter((record) => {
    const key = `${record.address}-${record.assetToBeSold}`;
    const currentEffectiveQuantity =
      record.quantity + record.totalLockedQuantity;

    if (!(key in lastSeenEffectiveQuantities)) {
      // Update dictionary
      lastSeenEffectiveQuantities[key] = currentEffectiveQuantity;
      return false; // No previous record to compare
    }

    // Check if the effective quantity has decreased
    const hasDecreased =
      currentEffectiveQuantity < lastSeenEffectiveQuantities[key];

    // Update the last seen effective quantity
    lastSeenEffectiveQuantities[key] = currentEffectiveQuantity;

    return hasDecreased;
  });

  // Calculate the average sale price for the filtered records
  if (filteredRecords.length === 0) {
    return 0; // If there are no records with decreased effective quantity, return 0
  }

  const totalPrice = filteredRecords.reduce(
    (sum, record) => sum + record.price,
    0
  );
  const averagePrice = totalPrice / filteredRecords.length;

  return averagePrice;
};

export const calculatePriceFluctuation = (records) => {
  const prices = records.map((record) => record.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
};

export const calculateVolumeTraded = (records) => {
  // Create a map to track the latest combined quantity for each address
  const addressQuantityMap = new Map();

  return records.reduce((acc, record) => {
    // Calculate the combined quantity of quantity and totalLockedQuantity
    const currentCombinedQuantity =
      record.quantity + record.totalLockedQuantity;

    // Get the previous combined quantity for this address, if any
    const previousCombinedQuantity =
      addressQuantityMap.get(record.address) || currentCombinedQuantity;

    // Update the map with the current combined quantity
    addressQuantityMap.set(record.address, currentCombinedQuantity);

    // Calculate the quantity decrease
    const quantityDecrease = previousCombinedQuantity - currentCombinedQuantity;

    // Only add to the accumulator if there's a decrease in quantity
    if (quantityDecrease > 0) {
      acc += quantityDecrease;
    }

    return acc;
  }, 0);
};

// Helpers to get time `x` months/years ago and date
export const getOneYearAgoTime = () => {
  const time =
    dayjs().utc().subtract(1, 'year').format('YYYY-MM-DD HH:mm:ss') + ' UTC';
  return time;
};
export const getSixMonthsAgoTime = () => {
  const time =
    dayjs().utc().subtract(6, 'months').format('YYYY-MM-DD HH:mm:ss') + ' UTC';
  return time;
};
export const getDate = (record) => {
  const date = dayjs(record.block_timestamp).format('YYYY-MM-DD');
  return date;
};

//Helpers for timeFilter
export const timeFilterForSixMonths = () => {
  return '1';
};
export const timeFilterForOneYear = () => {
  return '2';
};
export const timeFilterForAll = () => {
  return '3';
};
