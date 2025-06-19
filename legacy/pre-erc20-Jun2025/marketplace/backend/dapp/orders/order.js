import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
  setSearchQueryOptionsPrime,
} from '/helpers/utils';
import dayjs from 'dayjs';
import constants from '../../helpers/constants';

const contractName = 'Order';
const contractFilename = `${util.cwd}/dapp/orders/contracts/Order.sol`;

/**
 * Upload a new Order
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Order's constructor
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

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the order contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */

function marshalIn(_args) {
  const defaultArgs = {
    orderId: '',
    buyerOrganization: '',
    sellerOrganization: '',
    orderDate: 0,
    orderTotal: 0,
    orderShippingCharges: 0,
    status: 1,
    amountPaid: 0,
    buyerComments: '',
    sellerComments: '',
    createdDate: 0,
    paymentSessionId: '',
    shippingAddress: 0,
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
 * As our arguments come into the order contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for order to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Order deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * Bind an existing Order contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new order contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Order contract
 * @param options Order deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueOrderID.
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
  const { uniqueOrderID, address, ...restArgs } = args;
  let order;

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, {
      key: 'address',
      value: address,
    });
    order = await searchOne(contractName, searchArgs, options, user);
  } else {
    const searchArgs = setSearchQueryOptions(restArgs, {
      key: 'uniqueOrderID',
      value: uniqueOrderID,
    });
    order = await searchOne(contractName, searchArgs, options, user);
  }
  if (!order) {
    return undefined;
  }

  return marshalOut({
    ...order,
  });
}

async function getAll(admin, args = {}, options) {
  const orders = await searchAllWithQueryArgs(
    contractName,
    args,
    options,
    admin
  );

  const queryArgs = await searchAllWithQueryArgs(
    contractName,
    {
      ...args,
      limit: undefined,
      offset: 0,
      order: undefined,
      queryOptions: {
        select: 'count',
      },
    },
    options,
    admin
  );

  return {
    orders: orders.map((order) => marshalOut(order)),
    total: queryArgs[0].count,
  };
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
 * Transfer the ownership of a Order
 * @param newOwner The organization address of the new owner of the Order.
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
      "You cannot transfer the ownership of a Order you don't own",
      { newOwner }
    );
  }

  return transferStatus;
}

export default {
  uploadContract,
  contractName,
  contractFilename,
  bindAddress,
  get,
  getAll,
  transferOwnership,
  marshalIn,
  marshalOut,
  getHistory,
};
