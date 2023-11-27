import { util, rest, importer } from "/blockapps-rest-plus";
import config from "/load.config";
import RestStatus from "http-status-codes";
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
  setSearchQueryOptionsPrime
} from "/helpers/utils";
import dayjs from "dayjs";
import constants from "../../helpers/constants";

const contractName = "SaleOrder";
const contractFilename = `${util.cwd}/dapp/orders/contracts/SaleOrder.sol`;

/**
 * Upload a new Sale Order
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Sale Order's constructor
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
    throw new Error(error.join("\n"));
  }

  const copyOfOptions = {
    ...options,
    history: contractName,
  };

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = "removed";

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the sale order contract they first pass through `marshalIn` and
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
 * As our arguments come into the sale order contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for sale order to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Sale Order deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args) =>
    get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing Sale Order contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new order contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Sale Order contract
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
  const { address, ...restArgs } = args;
  let order;

  const searchArgs = setSearchQueryOptions(restArgs, {
    key: "address",
    value: address,
  });
  order = await searchOne(constants.orderTableName, searchArgs, options, user);

  if (!order) {
    return undefined;
  }

  return marshalOut({
    ...order,
  });
}

async function getAll(admin, args = {}, options) {
  let saleOrders;

  saleOrders = await searchAllWithQueryArgs(constants.orderTableName, args, options, admin);

  const count = await searchAllWithQueryArgs(
    constants.orderTableName,
    {
    ...args,
    limit: undefined,
    offset: 0,
    order: undefined,
    queryOptions: {
      select: "count",
      }
    },
    options,
    admin
  );

  return saleOrders ? { orders: saleOrders.map((order) => marshalOut(order)), total: count[0].count } : undefined;
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

async function cancelOrder(user, contract, options, comments = "") {
  const callArgs = {
    contract,
    method: "cancelOrder",
    args: util.usc({ comments: comments }),
  };
  const cancelStatus = await rest.call(user, callArgs, options);

  if (parseInt(cancelStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      cancelStatus,
      "You cannot cancel an order you don't co-own",
      {}
    );
  }

  return cancelStatus;
}

/**
 * Transfer the ownership of a SimpleSale
 * @param newOwner The common name of the new owner of the SimpleSale.
 */
async function transferOwnership(user, contract, options, fulfillmentDate, comments) {
  const callArgs = {
    contract,
    method: "transferOwnership",
    args: util.usc({ fulfillmentDate: fulfillmentDate, comments: comments }),
  };
  const transferStatus = await rest.call(user, callArgs, options);

  console.log("transferStatus", transferStatus);
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
  cancelOrder,
  transferOwnership,
  marshalIn,
  marshalOut,
  getHistory,
};
