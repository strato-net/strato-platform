import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs, setSearchQueryOptionsPrime } from '/helpers/utils';
import dayjs from 'dayjs';
import constants, { PAYMENT_TYPES } from '../../helpers/constants';

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
    }

    const copyOfOptions = {
        ...options,
        query: {
            address: `eq.${address}`,
        },
        chainIds: [chainId]
    }

    const history = await rest.search(user, contractArgs, copyOfOptions)
    return history
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
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
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
    let sale;
    let searchArgs;

    if (assetToBeSold) {
        searchArgs = setSearchQueryOptions(restArgs, 
            [{
                key: "assetToBeSold",
                value: assetToBeSold,
            },
            {
                key: "state",
                value: 1
            }
            ]);
    }
    else {
        searchArgs = setSearchQueryOptions(restArgs, 
            [{
                key: "address",
                value: address,
            },
            {
                key: "state",
                value: 1
            }
            ]);
    }

    sale = await searchOne(contractName, searchArgs, options, user);

    if (!sale) {
        return undefined;
    }


    return marshalOut({
        ...sale,
    });
}

async function getAll(admin, args = {}, options) {
    const { saleAddresses, assetAddresses, state, paymentMethod, ...restArgs } = args;
    let sales;

    if (assetAddresses && paymentMethod) {
        sales = await searchAllWithQueryArgs(contractName, { 
            assetToBeSold: assetAddresses, 
            state: state ? state : 1,
            payment: PAYMENT_TYPES[paymentMethod]
        }, options, admin);
    }
    else {
        sales = await searchAllWithQueryArgs(contractName, { address: saleAddresses, state: state ? state : 1 }, options, admin);
    }

    return sales ? sales.map((sale) => marshalOut(sale)) : undefined;
}

async function createSplitSale(user, args = {}, options, contract) {
    const callArgs = {
        contract,
        method: "createSplitSale",
        args: util.usc({ ...args }),
      };
      const [splitStatus, saleAddress] = await rest.call(user, callArgs, options);
    
      if (parseInt(splitStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
          splitStatus,
          "Create Split Sale has failed",
          { ...args }
        );
      }
    
      return saleAddress;
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
    createSplitSale,
    marshalIn,
    marshalOut,
    getHistory
}
