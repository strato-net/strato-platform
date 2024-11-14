import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
  waitForAddress,
} from '/helpers/utils';
import dayjs from 'dayjs';
import constants from '../../helpers/constants';

const contractName = 'Metals';
const contractFilename = `${util.cwd}/dapp/items/contracts/Metals.sol`;
const contractEvents = { OWNERSHIP_UPDATE: 'OwnershipUpdate' };

/**
 * Uploads a new Metals item
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Item's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
  const constructorArgs = marshalIn(_constructorArgs);

  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(constructorArgs),
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

  const searchOptions = {
    ...options,
    org: constants.blockAppsOrg,
    query: {
      address: `eq.${contract.address}`,
    },
  };

  await waitForAddress(user, { name: constants.assetTableName }, searchOptions);

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
 * As our arguments come into the item contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for item to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Item deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args = { address: contract.address }) =>
    get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.transferOwnership = async (newOwner) =>
    transferOwnership(user, contract, options, newOwner);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing Metals contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new item contract.</caption>
 * const adminBoundContract = createArt(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Item contract
 * @param options Item deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueItemID.
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
  const { uniqueItemID, address, ...restArgs } = args;
  let item;

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, {
      key: 'address',
      value: address,
    });
    item = await searchOne(constants.assetTableName, searchArgs, options, user);
  } else {
    const searchArgs = setSearchQueryOptions(restArgs, {
      key: 'uniqueItemID',
      value: uniqueItemID,
    });
    item = await searchOne(constants.assetTableName, searchArgs, options, user);
  }
  if (!item) {
    return undefined;
  }

  return marshalOut({
    ...item,
  });
}

async function getAll(admin, args = {}, options) {
  const inventories = await searchAllWithQueryArgs(
    constants.assetTableName,
    { ...args, category: `['Metals']` },
    options,
    admin
  );
  return inventories.map((inventory) => marshalOut(inventory));
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

/**
 * Transfer the ownership of a Item
 * @param newOwner The organization address of the new owner of the Item.
 */
async function transferOwnership(user, contract, options, newOwner) {
  // they may tell us they want this date entered by the user, but we'll see
  const transferOwnershipDate = dayjs().unix();

  const callArgs = {
    contract,
    method: 'transferOwnership',
    args: util.usc({ addr: newOwner }), // could be transferOwnershipDate
  };
  const transferStatus = await rest.call(user, callArgs, options);

  console.log('transferStatus', transferStatus);
  console.log(parseInt(transferStatus, 10));
  console.log(RestStatus.OK);
  if (parseInt(transferStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      transferStatus,
      "You cannot transfer the ownership of a Item you don't own",
      { newOwner }
    );
  }

  return transferStatus;
}

async function getAllOwnershipEvents(admin, args = {}, options) {
  const itemOwnershipEvents = await searchAllWithQueryArgs(
    `${contractName}.${contractEvents.OWNERSHIP_UPDATE}`,
    args,
    options,
    admin
  );
  return itemOwnershipEvents.map((item) => marshalOut(item));
}

export default {
  uploadContract,
  contractName,
  contractFilename,
  bindAddress,
  get,
  getAll,
  getAllOwnershipEvents,
  transferOwnership,
  marshalIn,
  marshalOut,
  getHistory,
};
