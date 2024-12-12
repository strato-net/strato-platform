import { util, rest } from '/blockapps-rest-plus';
import RestStatus from 'http-status-codes';
import {
  setSearchQueryOptions,
  searchOne,
  searchAllWithQueryArgs,
} from '/helpers/utils';
import constants, { getOneYearAgoTime } from '../../helpers/constants';
const pLimit = require('p-limit'); // Concurrency control library

const contractName = constants.saleTableName;

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the inventory contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */
function marshalIn(_args) {
  const defaultArgs = {};

  const args = {
    ...defaultArgs,
    ..._args,
  };
  return args;
}

async function getHistory(user, chainId, address, options) {
  const contractArgs = {
    name: `history@${contractName}`,
  };

  const copyOfOptions = {
    ...options,
    query: {
      address: `eq.${address}`,
    },
    chainIds: [chainId],
  };

  const history = await rest.search(user, contractArgs, copyOfOptions);
  return history;
}

/**
 * Augment returned contract state before it is returned.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 *
 * As our arguments come into the inventory contract they first pass through {@link marshalIn `marshalIn`}
 * and when we retrieve contract state they pass through `marshalOut`.
 *
 * (A mathematical analogy: {@link marshalIn `marshalIn`} and `marshalOut` form something like a
 * homomorphism)
 * @param _args - Contract state
 */
function marshalOut(_args) {
  const args = {
    ..._args,
  };
  return args;
}

/**
 * Bind functions relevant for inventory to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Inventory deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args) => get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing Inventory contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new inventory contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Inventory contract
 * @param options Inventory deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */
function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  };
  return bind(user, contract, options);
}

/**
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
  const { address, assetToBeSold, state, ...restArgs } = args;
  const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' };
  let sale;
  let searchArgs;
  const newArgs = {
    ...restArgs,
    queryOptions: { select: '*,BlockApps-Mercata-Sale-paymentServices(*)' },
  };

  if (assetToBeSold) {
    searchArgs = setSearchQueryOptions(newArgs, [
      {
        key: 'assetToBeSold',
        value: assetToBeSold,
      },
      {
        key: 'isOpen',
        value: true,
      },
    ]);
  } else {
    searchArgs = setSearchQueryOptions(newArgs, [
      {
        key: 'address',
        value: address,
      },
      {
        key: 'state',
        value: 1,
      },
    ]);
  }

  sale = await searchOne(contractName, searchArgs, newOptions, user);

  if (!sale) {
    return undefined;
  }

  return marshalOut({
    ...sale,
  });
}

async function getSaleHistory(user, args, options) {
  const newOptions = { ...options, org: 'history@BlockApps', app: 'Mercata' };
  let historySale = await searchAllWithQueryArgs(
    contractName,
    args,
    newOptions,
    user
  );

  if (!historySale) {
    return undefined;
  }

  return marshalOut({
    ...historySale,
  });
}

async function getAll(admin, args = {}, defaultOptions) {
  const {
    saleAddresses,
    assetAddresses,
    isOpen,
    range,
    saleGtField,
    saleGtValue,
    ...restArgs
  } = args;
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  let sales;
  if (assetAddresses) {
    sales = await searchAllWithQueryArgs(
      contractName,
      {
        assetToBeSold: assetAddresses,
        gtField: saleGtField,
        gtValue: saleGtValue,
        isOpen: isOpen,
        range: range,
        queryOptions: { select: '*,BlockApps-Mercata-Sale-paymentServices(*)' },
      },
      options,
      admin
    );
  } else {
    sales = await searchAllWithQueryArgs(
      contractName,
      {
        address: saleAddresses,
        isOpen: isOpen,
        queryOptions: { select: '*,BlockApps-Mercata-Sale-paymentServices(*)' },
        ...restArgs,
      },
      options,
      admin
    );
  }

  return sales ? sales.map((sale) => marshalOut(sale)) : undefined;
}

// Function to fetch sale histories in batches
async function fetchSaleHistoriesInBatches(
  rawAdmin,
  args = {},
  options = defaultOptions
) {
  const { assetToBeSold, filter = {}, maxConcurrency = 10 } = args;
  const chunkSize = 15; // chunk size for sale histories
  const limit = pLimit(maxConcurrency); // Concurrency control

  // Split asset addresses into batches of chunkSize
  const batches = [];
  for (let i = 0; i < assetToBeSold.length; i += chunkSize) {
    batches.push(assetToBeSold.slice(i, i + chunkSize));
  }

  // Fetch history for each chunk of assets
  const fetchHistoryChunk = async (chunk) => {
    const historyPromises = chunk.map((address) => {
      if (filter.order) {
        // Fetch sale history based on the filters provided
        return getSaleHistory(
          rawAdmin,
          {
            ...filter,
            assetToBeSold: address,
            gtField: 'price',
            gtValue: '0',
            queryOptions: {
              select:
                'address,block_timestamp,price,assetToBeSold,quantity,totalLockedQuantity',
            },
          },
          options
        );
      } else {
        // 12-Month Historical Data
        return getSaleHistory(
          rawAdmin,
          {
            assetToBeSold: address,
            order: 'block_timestamp.asc',
            gtField: 'block_timestamp',
            gtValue: getOneYearAgoTime(),
            notEqualsField: 'price',
            notEqualsValue: '0',
            queryOptions: {
              select:
                'address,block_timestamp,price,assetToBeSold,quantity,totalLockedQuantity',
            },
          },
          options
        );
      }
    });

    // Run history fetch requests in parallel for the current chunk
    return await Promise.all(historyPromises);
  };

  // Fetch all history chunks in parallel with concurrency control
  const allHistoryChunks = await Promise.all(
    batches.map((batch) => limit(() => fetchHistoryChunk(batch)))
  );

  // Flatten the array of results into a single array of histories
  return allHistoryChunks.flat();
}

async function fetchSalesInBatches(
  rawAdmin,
  args = {},
  options = defaultOptions
) {
  const chunkSize = 30; // Chunk size
  const maxConcurrency = 20; // Concurrency

  const { assetToBeSold, gtField, gtValue, order, salesFilter } = args;

  const batches = [];
  for (let i = 0; i < assetToBeSold.length; i += chunkSize) {
    batches.push(assetToBeSold.slice(i, i + chunkSize));
  }

  console.log('Total number of batches:', batches.length);

  const limit = pLimit(maxConcurrency); // Concurrency control setup

  const fetchChunkSales = async (chunk) => {
    try {
      console.log(`Fetching sales for chunk with ${chunk.length} assets`);

      let chunkSales;
      if (gtField && gtValue) {
        chunkSales = await getAll(
          rawAdmin,
          {
            assetToBeSold: chunk,
            gtField: gtField || salesFilter.gtField,
            gtValue: gtValue || salesFilter.gtValue,
            order: order || salesFilter.order,
            queryOptions: { select: 'block_timestamp,assetToBeSold,price' },
            ...salesFilter,
            notEqualsField: 'price',
            notEqualsValue: '0',
          },
          options
        );
      } else {
        chunkSales = await getAll(
          rawAdmin,
          {
            assetToBeSold: chunk,
            order: order || salesFilter.order,
            queryOptions: { select: 'block_timestamp,assetToBeSold,price' },
            notEqualsField: 'price',
            notEqualsValue: '0',
          },
          options
        );
      }

      console.log(`Fetched ${chunkSales.length} sales for chunk`);
      return chunkSales || [];
    } catch (error) {
      console.error(
        `Error fetching sales for chunk ${chunk.join(', ')}`,
        error
      );
      return [];
    }
  };

  const allSalesChunks = await Promise.all(
    batches.map((chunk) => limit(() => fetchChunkSales(chunk)))
  );

  const allSales = allSalesChunks.flat();
  console.log('Completed fetching sales. Total sales:', allSales.length);
  return allSales;
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

export default {
  contractName,
  bindAddress,
  get,
  getAll,
  marshalIn,
  marshalOut,
  getHistory,
  getSaleHistory,
  fetchSalesInBatches,
  fetchSaleHistoriesInBatches,
};
