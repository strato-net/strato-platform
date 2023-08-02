import { util, rest, importer } from "/blockapps-rest-plus";
import config from "/load.config";
import RestStatus from "http-status-codes";
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
} from "/helpers/utils";
import dayjs from "dayjs";

import productJs from "./order";
import orderJs from 'dapp/orders/order';
import orderLineJs from 'dapp/orders/orderLine';

const contractName = "OrderManager";
const contractFilename = `${util.cwd}/dapp/products/contracts/OrderManager.sol`;

/**
 * Upload a new Order manager
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of order's constructor
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

function marshalInUpdateSeller(_args){
  const defaultArgs = {
    status:1,
    fullfilmentDate:0,
    sellerComments:''
  }
  const args = {
    ...defaultArgs,
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
 * Bind an existing Order contract to a new user token. Useful for having multiple users test
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
  const defaultOptions = {
    ...options,
  };
  contract.getState = async () => getState(user, contract, options);
  contract.getOrder = async (args, _options = defaultOptions) =>
    orderJs.get(user, args, _options);
  contract.getOrders = async (user,args, _options = defaultOptions) =>
    orderJs.getAll(user, args, _options);
  contract.createOrder = async (args) =>
    createOrder(user, contract, args, options);
  contract.updateBuyerDetails = async (args) =>
    updateBuyerDetails(user, contract, args, options);
  contract.updateSellerDetails = async (args) =>
    updateSellerDetails(user, contract, args, options);
  contract.getInventoriesAndAvailableQuantity = async (args) =>
    getInventoriesAndAvailableQuantity(user, contract, args, options);
  contract.addOrderLine = async (args) =>
    addOrderLine(user, contract, args, options);
  contract.getOrderLine = async (args,options=defaultOptions) =>
    orderLineJs.get(user, args, options);
  contract.getOrderLines = async (args,options=defaultOptions) =>
    orderLineJs.getAll(user, args, options);
  return contract;
}

// * create the order
async function createOrder(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "createOrder",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, orderAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.CREATED)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, orderAddress];
}

/**
 * Update buyer order details
 */
 async function updateBuyerDetails(admin, contract, _args, baseOptions) {
  _args = {
    orderAddress:_args.orderAddress,
    ..._args
  }
  
  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "status":
        return agg | (base << 0);
      case "buyerComments":
        return agg | (base << 1);
      default:
        return agg;
    }
  }, 0);

  

  const callArgs = {
    contract,
    method: "updateBuyerDetails",
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, OrderAddress, quantities] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, OrderAddress, quantities];
}



/**
 * Update seller order details
 */
 async function updateSellerDetails(admin, contract, _args, baseOptions) {
  const args = marshalInUpdateSeller(_args);
  // console.log("===========================================",_args);

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "status":
        return agg | (base << 0);
      case "fullfilmentDate":
        return agg | (base << 1);
      case "sellerComments":
        return agg | (base << 2);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: "updateSellerDetails",
    args: util.usc({
      scheme,
      ...args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, OrderAddress, quantities] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, OrderAddress, quantities];
}


/**
 * Add the oderLine for a order
 */
 async function addOrderLine(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "addOrderLine",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, orderLineAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, orderLineAddress];
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
  bindAddress,
  uploadContract,
  contractName,
  contractFilename,
  marshalOut,
  createOrder
};
