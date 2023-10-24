import { util, rest, importer } from '/blockapps-rest-plus';
import RestStatus from 'http-status-codes';

import marketplaceItemJs from './marketplaceItem';
import eventJs from './event';

const contractName = 'MarketplaceItemManager';
const contractFilename = `${util.cwd}/dapp/items/contracts/MarketplaceItemManager.sol`;

/**
 * Upload a new Marketplace Item Manager 
 * @param user User token (typically an admin)
 * @param _constructorArgs Constructor Arguments
 * @param options Deployment options (found in _/config/*.config.yaml_ via _load.config.js_) 
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
      history: contractName
  }

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = 'removed';

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 * 
 * As our arguments come into the MarketplaceItemManager contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
  const defaultArgs = {
      productId: '',
      inventoryId: '',
      uniqueProductCode: '',
      itemObject: {
        itemNumber: 0,
        serialNumber: '',
        rawMaterialProductName: [''],
        rawMaterialProductId: [''],
        rawMaterialSerialNumber: ['']
      },
      status: 1,
      comment: '',
      createdDate: 0,
      name: '',
      description: '',
      manufacturer: '',
      unitOfMeasurement: 1,
      userUniqueProductCode: '',
      leastSellableUnit: 0,
      imageKey: '',
      isActive: false,
      category: '',
      subCategory: '',
      quantity: 0,
      pricePerUnit: 0,
      batchId: '',
      inventoryType: '',
      inventoryStatus: 1
  };

  const args = {
      ...defaultArgs,
      ..._args,
  };
  return args;
}

/**
 * Augment returned contract state before it is returned.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 * 
 * As our arguments come into the MarketplaceItemManager contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

/** 
 * Bind an existing Product contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new product contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the MarketplaceItemManager contract
 * @param options Deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */
function bindAddress(user, address, options) {
  const contract = {
      name: contractName,
      address,
  };
  return bind(user, contract, options);
}

function bind(user, _contract, options) {
  const contract = { ..._contract };
  contract.getItem = async (args, options) => marketplaceItemJs.get(user, args, options);
  contract.getItems = async (args, options) => marketplaceItemJs.getAll(user, args, options);
  contract.getAllOwnershipEvents = async (args, options) => marketplaceItemJs.getAllOwnershipEvents(user, args, options);
  contract.getEvents = async (args, options) => eventJs.getAll(user, args, options);
  contract.addMarketplaceItem = async (args) => addMarketplaceItem(user, contract, args, options);
  contract.updateItem = async (args) => updateItem(user, contract, args, options);
  contract.addEvent = async (args) => addEvent(user, contract, args, options);
  contract.certifyEvent = async (args) => certifyEvent(user, contract, args, options);
  contract.transferOwnership = async (args) => transferOwnership(user, contract, args, options);
  contract.updateProduct = async (args) => updateProduct(user, contract, args, options);
  contract.deleteProduct = async (args) => deleteProduct(user, contract, args, options);
  contract.updateInventory = async (args) => updateInventory(user, contract, args, options);
  contract.updateInventoriesQuantities = async (args) => updateInventoriesQuantities(user, contract, args, options);
  contract.resellInventory = async (args) => resellInventory(user, contract, args, options);
  return contract
}

// * Add a marketplace item
async function addMarketplaceItem(admin, contract, _args, baseOptions) {
  const itemArgs = marshalIn(_args);
  const callArgs = {
      contract,
      method: 'addMarketplaceItem',
      args: util.usc(itemArgs),
  }
  const options = {
      ...baseOptions,
      history: [contractName],
  }

  const [restStatus, itemAddress, repeatedSerialNumbers] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, itemAddress, repeatedSerialNumbers];
}

/**
 * Update Item
 */
async function updateItem(admin, contract, _args, baseOptions) {
    
  const scheme = Object.keys(_args).reduce((agg, key) => {
      const base = 1
      switch (key) {
          case 'status':
              return agg | (base << 0)
          case 'comment':
              return agg | (base << 1)
          default:
              return agg
      }
  }, 0)
  const callArgs = {
      contract,
      method: 'updateItem',
      args: util.usc({
          scheme,
          ..._args
      }),
  }

  const options = {
      ...baseOptions,
      history: [contractName],
  }

  const [restStatus, itemAddress] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, itemAddress];
}

// * Add the event
async function addEvent(admin, contract, _args, baseOptions) {
  // const itemArgs = marshalIn(_args);
  const callArgs = {
      contract,
      method: 'addEvent',
      args: util.usc(_args),
  }
  const options = {
      ...baseOptions,
      history: [contractName],
  }

  const [restStatus, eventAddresses] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, eventAddresses.slice(0, -1)];
}

/**
 * Update Event
 */
async function certifyEvent(admin, contract, _args, baseOptions) {
  _args = {
      eventAddress: _args.eventAddress,
      certifiedDate: _args.certifiedDate,
      ..._args.updates,
    };
    
  const scheme = Object.keys(_args).reduce((agg, key) => {
      const base = 1
      switch (key) {
          case 'certifierComment':
              return agg | (base << 0)
          case 'certifiedDate':
              return agg | (base << 1)
          default:
              return agg
      }
  }, 0)
  const callArgs = {
      contract,
      method: 'certifyEvent',
      args: util.usc({
          scheme,
          ..._args
      }),
  }
  const options = {
      ...baseOptions,
      history: [contractName],
  }
  const [restStatus, message] = await rest.call(admin, callArgs, options);
  if (parseInt(restStatus, 10) !== RestStatus.OK && parseInt(restStatus, 10) !== RestStatus.FORBIDDEN) throw new rest.RestError(restStatus, 0, { callArgs });
  return [restStatus, message];
}

// * Transfer the ownership of the items
async function transferOwnership(admin, contract, _args, baseOptions) {
  const callArgs = {
      contract,
      method: 'transferOwnership',
      args: util.usc(_args),
  }
  const options = {
      ...baseOptions,
      history: [contractName],
  }

  const [restStatus, itemAddress] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, itemAddress];
}

/**
 * Update Product
 */
async function updateProduct(admin, contract, _args, baseOptions) {
  _args = { marketplaceItemAddress: _args.marketplaceItemAddress, ..._args.updates };

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "description":
        return agg | (base << 0);
      case "imageKey":
        return agg | (base << 1);
      case "isActive":
        return agg | (base << 2);
      case "userUniqueProductCode":
        return agg | (base << 3);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: "updateProduct",
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus];
}

/**
 * Delete Product
 */
async function deleteProduct(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "deleteProduct",
    args: util.usc({
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, deletedStatus] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, deletedStatus];
}

/**
 * Update the inventory for a product
 */
async function updateInventory(admin, contract, _args, baseOptions) {
  _args = {
    marketplaceItemAddress: _args.marketplaceItemAddress,
    ..._args.updates,
  };
  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "pricePerUnit":
        return agg | (base << 0);
      case "status":
        return agg | (base << 1);
      default:
        return agg;
    }
  }, 0);
  const callArgs = {
    contract,
    method: "updateInventory",
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };
  const [restStatus, inventoryAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, inventoryAddress];
}

/**
 * Update the quantities of the inventories for a product
 */
async function updateInventoriesQuantities(admin, contract, _args, baseOptions) {

  const callArgs = {
    contract,
    method: "updateInventoriesQuantities",
    args: util.usc({
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };
  const [restStatus] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus];
}

/**
 * Resell a portion of existing inventory
 */
async function resellInventory(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "resellInventory",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, inventoryAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, inventoryAddress];
}

export default {
  bindAddress,
  uploadContract,
  contractName,
  contractFilename,
  marshalOut,
  addMarketplaceItem,
  updateItem,
  addEvent,
  certifyEvent,
  transferOwnership,
  updateProduct,
  deleteProduct,
  updateInventory,
  updateInventoriesQuantities,
  resellInventory
}