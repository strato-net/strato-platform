import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { searchAllWithQueryArgs } from '/helpers/utils';

import itemJs from 'dapp/items/item';
import eventJs from 'dapp/items/event';

import rawMaterialJs from 'dapp/items/rawMaterials/rawMaterial';

const contractName = 'ItemManager';
const contractFilename = `${util.cwd}/dapp/items/contracts/ItemManager.sol`;
const contractEvents = { ITEM_TRANSFER: 'ItemTransfers' };

/**
 * Upload a new Product manager
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
/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the item contract they first pass through `marshalIn` and
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
    status: 1,
    comment: '',
    createdDate: 0,
    uniqueProductCode: '',
    itemObject: {
      itemNumber: 0,
      serialNumber: '',
      rawMaterialProductName: [''],
      rawMaterialProductId: [''],
      rawMaterialSerialNumber: [''],
    },
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
 * As our arguments come into the productManager contract they first pass through {@link marshalIn `marshalIn`}
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

/**
 * Bind an existing Product contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new product contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Product contract
 * @param options Product deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
  contract.getState = async () => getState(user, contract, options);
  contract.getItem = async (args, options) => itemJs.get(user, args, options);
  contract.getItems = async (args, options) =>
    itemJs.getAll(user, args, options);
  contract.getAllOwnershipEvents = async (args, options) =>
    itemJs.getAllOwnershipEvents(user, args, options);
  contract.addItem = async (args) => addItem(user, contract, args, options);
  contract.transferOwnership = async (args) =>
    transferOwnership(user, contract, args, options);
  contract.getAllItemTransferEvents = async (args, options) =>
    getAllItemTransferEvents(user, args, options);
  contract.updateItem = async (args) =>
    updateItem(user, contract, args, options);
  contract.addEvent = async (args) => addEvent(user, contract, args, options);
  contract.certifyEvent = async (args) =>
    certifyEvent(user, contract, args, options);
  contract.getEvents = async (args, options) =>
    eventJs.getAll(user, args, options);
  contract.getRawMaterial = async (args, options) =>
    rawMaterialJs.get(user, args, options);
  contract.getRawMaterials = async (args, options) =>
    rawMaterialJs.getAll(user, args, options);
  return contract;
}

// * Add the item
async function addItem(admin, contract, _args, baseOptions) {
  const itemArgs = marshalIn(_args);
  const callArgs = {
    contract,
    method: 'addItem',
    args: util.usc(itemArgs),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, itemAddress, repeatedSerialNumbers] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, itemAddress, repeatedSerialNumbers];
}

// * Transfer the ownership of the items
async function transferOwnership(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: 'transferOwnership',
    args: util.usc(_args),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, itemAddress] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, itemAddress];
}

/**
 * Update Item
 */
async function updateItem(admin, contract, _args, baseOptions) {
  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case 'status':
        return agg | (base << 0);
      case 'comment':
        return agg | (base << 1);
      default:
        return agg;
    }
  }, 0);
  const callArgs = {
    contract,
    method: 'updateItem',
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, itemAddress] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, itemAddress];
}

// * Add the event
async function addEvent(admin, contract, _args, baseOptions) {
  // const itemArgs = marshalIn(_args);
  const callArgs = {
    contract,
    method: 'addEvent',
    args: util.usc(_args),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, eventAddresses] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.CREATED)
    throw new rest.RestError(restStatus, 0, { callArgs });

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
    const base = 1;
    switch (key) {
      case 'certifierComment':
        return agg | (base << 0);
      case 'certifiedDate':
        return agg | (base << 1);
      default:
        return agg;
    }
  }, 0);
  const callArgs = {
    contract,
    method: 'certifyEvent',
    args: util.usc({
      scheme,
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };
  const [restStatus, message] = await rest.call(admin, callArgs, options);
  if (
    parseInt(restStatus, 10) !== RestStatus.OK &&
    parseInt(restStatus, 10) !== RestStatus.FORBIDDEN
  )
    throw new rest.RestError(restStatus, 0, { callArgs });
  return [restStatus, message];
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

async function getAllItemTransferEvents(admin, args = {}, options) {
  const itemTransferEvents = await searchAllWithQueryArgs(
    `${contractName}.${contractEvents.ITEM_TRANSFER}`,
    args,
    options,
    admin
  );
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
    transfers: itemTransferEvents.map((item) => marshalOut(item)),
    total: total[0].count,
  };
}

export default {
  bindAddress,
  uploadContract,
  contractName,
  contractFilename,
  marshalOut,
  getAllItemTransferEvents,
  addItem,
  updateItem,
  addEvent,
  certifyEvent,
};
