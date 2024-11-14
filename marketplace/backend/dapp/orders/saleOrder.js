import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import saleJs from '../../dapp/orders/sale';
import {
  setSearchQueryOptions,
  searchOne,
  searchAllWithQueryArgs,
  waitForAddress,
} from '/helpers/utils';
import constants from '../../helpers/constants';
import axios from 'axios';
import paymentService from '../payments/paymentService';

const contractName = 'SimpleOrder';
const contractFilename = `${util.cwd}/dapp/mercata-base-contracts/Templates/Orders/SimpleOrder.sol`;
const paymentServiceContractName = 'PaymentService';
const paymentTableName = 'PaymentService.Order';

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

  await waitForAddress(user, { name: constants.orderTableName }, searchOptions);

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
  const { amount, totalPrice, createdDate, block_timestamp, status } = _args;
  const args = {
    ..._args,
    totalPrice: totalPrice || amount,
    createdDate: createdDate || new Date(block_timestamp).getTime() / 1000,
    status: status || 3,
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

  contract.get = async (args) => get(user, args, options);
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
  const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' };
  let order;

  let searchArgs = {
    limit: 1,
    queryOptions: {
      order: 'status.desc',
      transaction_hash: `eq.${address}`,
    },
  };
  order = await searchAllWithQueryArgs(
    paymentTableName,
    searchArgs,
    newOptions,
    user
  );

  if (order.length === 0) {
    // Legacy orders need to join array tables.
    let legacyArgs = {
      transaction_hash: address,
      limit: 1,
      queryOptions: {
        select:
          constants.attach_saleAddresses_Quantities_completedSales_onOrder,
      },
    };
    order = await searchAllWithQueryArgs(
      constants.orderTableName,
      legacyArgs,
      newOptions,
      user
    );
  }

  if (!order) {
    return undefined;
  }

  // Flatten the order object
  return marshalOut(order['0'] ? { ...order['0'] } : { ...order });
}

async function getAll(admin, args = {}, options) {
  let saleOrders;
  const { offset = 0, limit = 2000, order } = args;
  const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' };

  const newCountArgs = {
    ...args,
    limit: undefined,
    offset: 0,
    order: undefined,
    queryOptions: {
      select: 'count',
    },
  };

  const countArgs = {
    ...args,
    limit: undefined,
    offset: 0,
    order: undefined,
    queryOptions: {
      select: 'count',
    },
  };

  const newCount = await searchAllWithQueryArgs(
    paymentTableName,
    newCountArgs,
    newOptions,
    admin
  );

  let totalCount = newCount[0] ? newCount[0].count : 0;

  // Get the latest payment event for each sale token
  if (totalCount !== 0) {
    const uniqueOrderArgs = {
      ...args,
      limit: undefined,
      offset: 0,
      queryOptions: {
        select: 'id:id.max(),orderHash,createdDate',
      },
    };

    let uniqueOrders = await searchAllWithQueryArgs(
      paymentTableName,
      uniqueOrderArgs,
      newOptions,
      admin
    );

    uniqueOrders = uniqueOrders.reduce((acc, order) => {
      // Find if the orderHash already exists in the accumulator
      const existingOrderIndex = acc.findIndex(
        (existingOrder) => existingOrder.orderHash === order.orderHash
      );

      if (existingOrderIndex === -1) {
        // If the orderHash does not exist, add the order to the accumulator
        acc.push(order);
      } else {
        // If the orderHash exists, compare createdDate and keep the latest one
        if (
          new Date(order.createdDate) >
          new Date(acc[existingOrderIndex].createdDate)
        ) {
          acc[existingOrderIndex] = order;
        }
      }

      return acc;
    }, []);

    const idArgs = {
      id: uniqueOrders.map((uo) => uo.id),
      order: order,
    };
    saleOrders = await searchAllWithQueryArgs(
      paymentTableName,
      idArgs,
      newOptions,
      admin
    );
    saleOrders = saleOrders.map((item) => ({ ...item, type: 'Order' }));
  }

  // ACH status updates
  let orderHashesToIndicies = {};
  let paymentServicesToOrderHashes = {};
  let paymentServiceRes = {};

  if (saleOrders) {
    for (let i = 0; i < saleOrders.length; i++) {
      const order = saleOrders[i];
      if (parseInt(order.status) === 2) {
        if (paymentServicesToOrderHashes[order.address]) {
          paymentServicesToOrderHashes[order.address].push(order.orderHash);
        } else {
          paymentServicesToOrderHashes[order.address] = [order.orderHash];
        }
        orderHashesToIndicies[order.orderHash] = i;
      }
    }
  }
  if (Object.keys(paymentServicesToOrderHashes).length > 0) {
    const paymentServiceAddresses = Object.keys(paymentServicesToOrderHashes);
    const paymentServices = await paymentService.getAll(
      admin,
      { address: paymentServiceAddresses },
      options
    );
    paymentServices.map(async (ppro) => {
      const serviceUrl = ppro.serviceURL || ppro.data.serviceURL;
      const statusRoute = ppro.orderStatusRoute || ppro.data.orderStatusRoute;
      const tokens = encodeURIComponent(
        JSON.stringify(paymentServicesToOrderHashes[ppro.address])
      );
      try {
        const statusRes = await axios
          .get(
            new URL(`${serviceUrl}${statusRoute}?orderHashes=${tokens}`).href
          )
          .then(function (res) {
            if (res.status === 200) {
              paymentServiceRes = { ...paymentServiceRes, ...res.data };
            }
          });
      } catch (error) {
        console.log('error', error);
      }
    });
  }
  if (Object.keys(paymentServiceRes).length > 0) {
    Object.keys(paymentServiceRes).forEach(function (key) {
      const index = orderHashesToIndicies[key];
      saleOrders[index] = {
        ...saleOrders[index],
        status: paymentServiceRes[key],
        type: 'Order',
      };
    });
  }

  let oldCount = 0;
  try {
    // Legacy orders need to join array tables.
    let oldArgs = {
      ...args,
      limit: undefined,
      offset: 0,
      queryOptions: {
        select:
          constants.attach_saleAddresses_Quantities_completedSales_onOrder,
      },
    };
    let oldSaleOrders = await searchAllWithQueryArgs(
      constants.orderTableName,
      oldArgs,
      newOptions,
      admin
    );
    oldSaleOrders = oldSaleOrders.map((item) => ({ ...item, type: 'Order' }));
    saleOrders = saleOrders
      ? [...saleOrders, ...oldSaleOrders]
      : [...oldSaleOrders];

    oldCount = await searchAllWithQueryArgs(
      constants.orderTableName,
      countArgs,
      newOptions,
      admin
    );
  } catch (err) {
    console.log('Legacy order table does not exist.', err, JSON.stringify(err));
  }

  totalCount += oldCount[0] ? oldCount[0].count : 0;

  if (order && order === 'createdDate.asc')
    saleOrders?.sort((a, b) => a?.createdDate - b?.createdDate);
  else saleOrders?.sort((a, b) => b?.createdDate - a?.createdDate);

  saleOrders = saleOrders?.slice(offset, parseInt(offset) + parseInt(limit));

  return saleOrders
    ? {
        orders: saleOrders?.map((order) => marshalOut(order)),
        total: totalCount,
      }
    : undefined;
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

async function cancelOrder(user, contract, args, options) {
  const callArgs = {
    contract,
    method: 'cancelOrder',
    args: util.usc({ ...args }),
  };
  const cancelStatus = await rest.call(user, callArgs, options);
  return cancelStatus;
}

/**
 * Complete an Order
 * @param newOwner The common name of the new owner of the SimpleSale.
 */
async function completeOrder(user, args, options) {
  const { orderAddress, ...restArgs } = args;
  const contract = { name: contractName, address: orderAddress };
  const callArgs = {
    contract,
    method: 'completeOrder',
    args: util.usc(restArgs),
  };
  const completionStatus = await rest.call(user, callArgs, options);

  console.log('completionStatus', completionStatus);
  console.log(parseInt(completionStatus, 10));
  console.log(RestStatus.OK);
  if (parseInt(completionStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      completionStatus,
      "You cannot complete an Order you don't own",
      { newOwner }
    );
  }

  return completionStatus;
}

/**
 * Update an Order Comment
 */
async function updateOrderComment(user, contract, options, comments) {
  const callArgs = {
    contract,
    method: 'updateComment',
    args: util.usc({ comments }),
  };
  const updateOrderCommentResponse = await rest.call(user, callArgs, options);

  if (parseInt(updateOrderCommentResponse, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      updateOrderCommentResponse,
      'Order Cannot Be Updated',
      {}
    );
  }

  return updateOrderCommentResponse;
}

export default {
  uploadContract,
  contractName,
  contractFilename,
  paymentServiceContractName,
  bindAddress,
  get,
  getAll,
  cancelOrder,
  completeOrder,
  updateOrderComment,
  marshalIn,
  marshalOut,
  getHistory,
};
