import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
  setSearchQueryOptionsPrime,
  waitForAddress,
} from '/helpers/utils';
import dayjs from 'dayjs';
import constants from '../../helpers/constants';
import saleJs from '../orders/sale';
import escrowJs from '../escrow/escrow';

const contractName = constants.assetTableName;
const transferContractName = `${contractName}.ItemTransfers`;
const contractFilename = `${util.cwd}/dapp/products/contracts/Inventory.sol`;
const saleContractName = 'SimpleSale';
const saleContract = constants.saleTableName;
const saleContractFilename = `${util.cwd}/dapp/mercata-base-contracts/Templates/Sales/SimpleSale.sol`;
const contractEvents = { ITEM_TRANSFER: 'ItemTransfers' };

/**
 * Upload a new Inventory
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Inventory's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(_constructorArgs),
  };

  let error = [];

  if (error.length) {
    throw new Error(error.join('\n'));
  }

  const copyOfOptions = {
    ...options,
    history: contractName,
  };

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = 'removed';

  return bind(user, contract, copyOfOptions);
}

async function uploadSaleContract(user, _constructorArgs, options) {
  const contractArgs = {
    name: saleContractName,
    source: await importer.combine(saleContractFilename),
    args: util.usc(_constructorArgs),
  };

  let error = [];

  if (error.length) {
    throw new Error(error.join('\n'));
  }

  const copyOfOptions = {
    ...options,
    history: saleContractName,
  };

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = 'removed';

  const searchOptions = {
    ...options,
    org: constants.blockAppsOrg,
    query: {
      address: `eq.${contract.address}`,
    },
  };

  await waitForAddress(user, { name: saleContract }, searchOptions);

  return contract;
}

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
  const defaultArgs = {
    pricePerUnit: 0,
    status: 0,
  };

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
  contract.checkSaleQuantity = async (args) =>
    checkSaleQuantity(user, args, options);
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

async function unlistItem(user, _contract, args, options) {
  const contract = { name: saleContractName, ..._contract };
  const callArgs = {
    contract,
    method: 'closeSale',
    args: util.usc({ ...args }),
  };
  const unlistStatus = await rest.call(user, callArgs, options);

  if (parseInt(unlistStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      unlistStatus,
      "You cannot unlist the item because it's already published",
      { callArgs }
    );
  }

  const searchOptions = {
    ...options,
    org: constants.blockAppsOrg,
    query: {
      address: `eq.${callArgs.contract.address}`,
      isOpen: `eq.false`,
    },
  };

  await waitForAddress(user, { name: saleContract }, searchOptions);

  return unlistStatus;
}

async function resellItem(user, contract, args, options) {
  const callArgs = {
    contract,
    method: 'mintNewUnits',
    args: util.usc({ ...args }),
  };

  const resellStatus = await rest.call(user, callArgs, options);

  if (parseInt(resellStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      resellStatus,
      'You cannot resell the item because it has already been sold by the original owner.',
      { callArgs }
    );
  }

  return resellStatus;
}

async function requestRedemption(user, contract, args, options) {
  const callArgs = {
    contract,
    method: 'requestRedemption',
    args: util.usc({ ...args }),
  };

  const [requestRedemptionStatus, assetAddress] = await rest.call(
    user,
    callArgs,
    options
  );

  if (parseInt(requestRedemptionStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      requestRedemptionStatus,
      'Error while requesting redemption',
      { callArgs }
    );
  }

  return [requestRedemptionStatus, assetAddress];
}

async function transferItem(user, argsArray, options) {
  try {
    // Prepare transfer call arguments
    const callArgsArray = argsArray.map((args) => ({
      contract: args.contract,
      method: 'automaticTransfer',
      args: util.usc({ ...args, contract: undefined }),
    }));

    // Make the transfer requests
    options.isDetailed = true;
    const transferStatuses = await rest.callList(user, callArgsArray, options);

    // Verify that all transfer responses are successful
    const allSuccessful = transferStatuses.every((transfer) => {
      return (
        transfer.data.contents &&
        transfer.data.contents.length > 0 &&
        parseInt(transfer.data.contents[0], 10) === RestStatus.OK
      );
    });
    if (!allSuccessful) {
      throw new rest.RestError(
        transferStatuses,
        'One or more transfers failed.',
        { callArgsArray }
      );
    }

    // Wait for each transfer to be reflected in the contract state
    const searchPromises = transferStatuses.map((transfer) => {
      const searchOptions = {
        ...options,
        org: constants.blockAppsOrg,
        query: {
          transaction_hash: `eq.${transfer.hash}`,
        },
      };
      return waitForAddress(
        user,
        { name: transferContractName },
        searchOptions
      );
    });
    await Promise.all(searchPromises);

    return argsArray.map((statusArray) => statusArray.transferNumber);
  } catch (error) {
    if (error.response && error.response.statusText.includes('SString')) {
      const extractedText = error.response.statusText.match(/"([^"]+)"/)[1];
      error.response.statusText = extractedText;
    }
    throw error;
  }
}

async function updateAssetStatus(user, contract, args, options) {
  const callArgs = {
    contract,
    method: 'updateStatus',
    args: util.usc({ ...args }),
  };

  const [updateStatus] = await rest.call(user, callArgs, options);

  if (parseInt(updateStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      updateStatus,
      'Error while updating Asset Status',
      { callArgs }
    );
  }

  return [updateStatus];
}

async function updateInventory(user, contract, args, options) {
  const callArgs = {
    contract,
    method: 'update',
    args: util.usc({ ...args.updates }),
  };

  const resellStatus = await rest.call(user, callArgs, options);

  if (parseInt(resellStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(resellStatus, 'You cannot update the item', {
      callArgs,
    });
  }

  return resellStatus;
}

async function updateSale(admin, contract, _args, options) {
  // const args = paymentJs.marshalIn(_args)
  const args = { ..._args };
  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case 'quantity':
        return agg | (base << 0);
      case 'price':
        return agg | (base << 1);
      case 'paymentServices':
        return agg | (base << 2);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: 'update',
    args: util.usc({
      scheme,
      ...args,
    }),
  };

  const restStatus = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { callArgs });
  }

  return restStatus;
}

/**
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args Lookup with an address or uniqueInventoryID.
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
  const { address, ...restArgs } = args;
  const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' };
  let inventory;

  const searchArgs = setSearchQueryOptions(restArgs, [
    {
      key: 'address',
      value: address,
    },
  ]);
  searchArgs.queryOptions.select = constants.attachImagesAndFiles;
  inventory = await searchOne(contractName, searchArgs, newOptions, user);

  if (!inventory) {
    return undefined;
  }

  const sale = await saleJs.get(
    user,
    { assetToBeSold: inventory.address, isOpen: true },
    newOptions
  );

  if (sale) {
    inventory = {
      ...inventory,
      price: sale.price,
      saleAddress: sale.address,
      saleQuantity: sale.quantity,
      paymentServices: sale
        ? sale['BlockApps-Mercata-Sale-paymentServices']
          ? sale['BlockApps-Mercata-Sale-paymentServices']
          : null
        : null,
    };
  }

  const escrow = await escrowJs.getEscrowForAsset(
    user,
    { value: `eq.${inventory.address}` },
    options
  );

  if (escrow) {
    inventory = {
      ...inventory,
      escrow,
    };
  }

  // Sort the images and files by their order
  if (inventory['BlockApps-Mercata-Asset-images']) {
    inventory['BlockApps-Mercata-Asset-images'].sort((a, b) => {
      return parseInt(a.key) - parseInt(b.key);
    });
  }

  return marshalOut({
    ...inventory,
  });
}

async function getAll(admin, args = {}, defaultOptions) {
  const {
    range,
    ownerCommonName,
    assetAddresses,
    status,
    isMarketplaceSearch,
    isTrendingSearch,
    userProfile,
    queryOptions,
    ...restArgs
  } = args;
  let isNullPriceRange = false; //TODO: find a better way to identify/handle this
  if (range !== undefined) {
    isNullPriceRange = range ? range[0].split(',')[1] == 0 : true;
  }
  let inventories;
  let sales;
  let finalInventory = [];
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };

  if (isTrendingSearch) {
    // Fetch the sales first
    sales = await saleJs.getAll(
      admin,
      {
        range,
        isOpen: true,
        order: 'block_timestamp.desc',
        offset: '0',
        gtField: args.gtField,
        gtValue: args.gtValue,
      },
      options
    );
    const trendingAssetAddresses = sales.map((sale) => sale.assetToBeSold);

    // Fetch the inventories matching the sales
    inventories = await searchAllWithQueryArgs(
      contractName,
      {
        ...restArgs,
        queryOptions: { select: constants.attachImagesAndFiles },
        address: trendingAssetAddresses,
        order: 'block_timestamp.desc',
        limit: '25',
      },
      options,
      admin
    );

    // Combine the inventories and sales data
    if (inventories) {
      inventories.forEach((inventory) => {
        const itemSale = sales.find(
          (sale) => sale.assetToBeSold == inventory.address && sale.isOpen
        );
        if (itemSale) {
          finalInventory.push({
            ...inventory,
            price: itemSale?.price,
            saleAddress: itemSale?.address,
            saleQuantity: itemSale?.quantity,
            saleDate: itemSale?.block_timestamp,
            paymentServices: itemSale
              ? itemSale['BlockApps-Mercata-Sale-paymentServices']
                ? itemSale['BlockApps-Mercata-Sale-paymentServices']
                : null
              : null,
            totalLockedQuantity: itemSale?.totalLockedQuantity,
          });
        }
      });
    }
  } else {
    // Fetch all Inventories and join sales table.
    if (ownerCommonName) {
      inventories = await searchAllWithQueryArgs(
        contractName,
        {
          ...restArgs,
          status,
          ownerCommonName: ownerCommonName,
          queryOptions: queryOptions
            ? queryOptions
            : { select: constants.attachSalesEscrowsAndImagesAndFiles },
        },
        options,
        admin
      );
    } else if (assetAddresses) {
      inventories = await searchAllWithQueryArgs(
        contractName,
        {
          ...restArgs,
          address: assetAddresses,
          queryOptions: {
            select: constants.attachSalesEscrowsAndImagesAndFiles,
          },
        },
        options,
        admin
      );
    } else {
      inventories = await searchAllWithQueryArgs(
        contractName,
        {
          ...restArgs,
          queryOptions: {
            select: constants.attachSalesEscrowsAndImagesAndFiles,
          },
        },
        options,
        admin
      );
    }

    // Currently can't filter on second table, so filtering sales fields here.
    // Sales only has price and quantity fields to filter, so better to join sales on asset table (asset has multiple filters for each route).
    if (inventories) {
      for (let i = 0; i < inventories.length; i++) {
        const inventory = inventories[i];
        if (
          inventory['BlockApps-Mercata-Sale'] &&
          inventory['BlockApps-Mercata-Sale'].length > 0 &&
          inventory['BlockApps-Mercata-Sale'].some(
            (item) => item.isOpen === true
          )
        ) {
          let sales = inventory['BlockApps-Mercata-Sale'].filter(
            (sale) => sale.isOpen === true
          );

          // Filter by quantity if userProfile is present
          if (userProfile) {
            sales = sales.filter((sale) => sale.quantity > 0);
          }

          // Filter by price range if range is specified
          if (range && range.length > 0) {
            const [field, min, max] = range[0].split(',');
            if (field === 'price') {
              sales = sales.filter(
                (sale) =>
                  sale.price >= parseFloat(min) && sale.price <= parseFloat(max)
              );
            }
          }

          // Combine the inventories with sales data if there are valid sales for user profile route
          if (userProfile) {
            if (
              sales.length > 0 &&
              sales[0].price !== null &&
              sales[0].price !== undefined &&
              sales[0].price !== 0 &&
              sales[0].saleType !== 'Escrow'
            ) {
              // Only combine if there are sales. We don't list unpublished items for this route.
              finalInventory.push({
                ...inventory,
                price: sales[0]?.price,
                saleAddress: sales[0]?.address,
                saleQuantity: sales[0]?.quantity,
                saleDate: sales[0]?.block_timestamp,
                totalLockedQuantity: sales[0]?.totalLockedQuantity,
                paymentServices: sales[0]
                  ? sales[0]['BlockApps-Mercata-Sale-paymentServices']
                    ? sales[0]['BlockApps-Mercata-Sale-paymentServices']
                    : null
                  : null,
                'BlockApps-Mercata-Sale': undefined, // Removing the nested sale data to avoid redundancy
              });
            }
          } else {
            // Just combine the data if userProfile is not present
            finalInventory.push({
              ...inventory,
              price: sales[0]?.price,
              saleAddress: sales[0]?.address,
              saleQuantity: sales[0]?.quantity,
              saleDate: sales[0]?.block_timestamp,
              totalLockedQuantity: sales[0]?.totalLockedQuantity,
              paymentServices: sales[0]
                ? sales[0]['BlockApps-Mercata-Sale-paymentServices']
                  ? sales[0]['BlockApps-Mercata-Sale-paymentServices']
                  : null
                : null,
              'BlockApps-Mercata-Sale': undefined, // Removing the nested sale data to avoid redundancy
            });
          }
        } else {
          let escrow;
          if (
            inventory['BlockApps-Mercata-Escrow-assets'] &&
            inventory['BlockApps-Mercata-Escrow-assets'].length > 0
          ) {
            escrow = inventory['BlockApps-Mercata-Escrow-assets'].find(
              (asset) =>
                asset['BlockApps-Mercata-Escrow']?.isActive === true &&
                asset.value === inventory.address
            )?.['BlockApps-Mercata-Escrow'];
          }
          if (isMarketplaceSearch && isNullPriceRange) {
            if (!escrow) {
              finalInventory.push({
                ...inventory,
                price: null,
                saleAddress: null,
                saleQuantity: null,
                saleDate: null,
                totalLockedQuantity: null,
                paymentServices: null,
              });
            }
          } else {
            if(!userProfile){
              finalInventory.push({ escrow, ...inventory });
            }
          }
        }
      }
    }
  }
  // Sort the images and files by their order
  return finalInventory
    ? finalInventory.map((inventory) => {
        if (inventory['BlockApps-Mercata-Asset-images']) {
          inventory['BlockApps-Mercata-Asset-images'].sort(
            (a, b) => parseInt(a.key) - parseInt(b.key)
          );
        }
        return marshalOut(inventory);
      })
    : undefined;
}

async function getAllItemTransferEvents(admin, args = {}, defaultOptions) {
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  let itemTransferEvents = await searchAllWithQueryArgs(
    `${contractName}.${contractEvents.ITEM_TRANSFER}`,
    args,
    options,
    admin
  );
  itemTransferEvents = itemTransferEvents.map((item) => ({
    ...item,
    type: 'Transfer',
  }));

  const total = await searchAllWithQueryArgs(
    `${contractName}.${contractEvents.ITEM_TRANSFER}`,
    {
      ...args,
      limit: undefined,
      offset: 0,
      order: undefined,
      queryOptions: { select: 'count' },
    },
    options,
    admin
  );

  return {
    transfers: itemTransferEvents.map(marshalOut),
    total: total[0]?.count,
  };
}

async function getOwnershipHistory(user, args, options) {
  const { originAddress, minItemNumber, maxItemNumber } = args;
  const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' };
  const searchArgs = {
    originAddress,
    gteField: 'maxItemNumber',
    gteValue: minItemNumber,
    lteField: 'minItemNumber',
    lteValue: maxItemNumber,
    sort: '+block_timestamp',
  };

  const history = await searchAllWithQueryArgs(
    `${contractName}.OwnershipTransfer`,
    searchArgs,
    newOptions,
    user
  );
  return history;
}

async function inventoryCount(admin, args = {}, defaultOptions) {
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  const { range, userProfile, ...newArgs } = args;
  const queryArgs = setSearchQueryOptionsPrime({
    ...newArgs,
    limit: undefined,
    offset: 0,
    order: undefined,
  });
  const totalResult = await searchAll(
    contractName,
    {
      ...queryArgs,
      sort: undefined, // can't sort and count together or postgres complains (redundant anyway)
      queryOptions: {
        ...queryArgs.queryOptions,
        select: 'count',
      },
    },
    options,
    admin
  );
  return totalResult[0].count;
}

async function checkSaleQuantity(admin, args, defaultOptions) {
  const { saleAddresses, orderQuantity } = args; // Assuming orderQuantity here is used differently now
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };

  // Fetch sales and assets data
  const sales = await saleJs.getAll(admin, { address: saleAddresses }, options);
  const assets = await searchAllWithQueryArgs(
    contractName,
    { sale: saleAddresses },
    options,
    admin
  );
  let insufficientDetails = [];

  sales.forEach((sale, index) => {
    const actualAvailableQuantity = sale.quantity;
    const requestedQuantity = orderQuantity[index]; // Accessing requested quantity via sale address

    if (actualAvailableQuantity < requestedQuantity) {
      const asset = assets.find((asset) => asset.sale === sale.address);
      if (asset) {
        insufficientDetails.push({
          assetName: asset.name,
          assetAddress: sale.assetToBeSold,
          availableQuantity: actualAvailableQuantity,
        });
      }
    }
  });

  if (insufficientDetails.length > 0) {
    return insufficientDetails;
  } else {
    // If all sales have sufficient quantities, return true
    return true;
  }
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
  uploadContract,
  uploadSaleContract,
  contractName,
  contractFilename,
  saleContractName,
  saleContractFilename,
  bindAddress,
  unlistItem,
  resellItem,
  requestRedemption,
  transferItem,
  updateAssetStatus,
  updateInventory,
  updateSale,
  checkSaleQuantity,
  get,
  getAll,
  getOwnershipHistory,
  getAllItemTransferEvents,
  inventoryCount,
  marshalIn,
  marshalOut,
  getHistory,
};
