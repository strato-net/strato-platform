import { util, rest } from '/blockapps-rest-plus';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAllWithQueryArgs } from '/helpers/utils';
import constants from '../../helpers/constants';

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
    const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' }
    let sale;
    let searchArgs;

    if (assetToBeSold) {
        searchArgs = setSearchQueryOptions(restArgs,
            [{
                key: "assetToBeSold",
                value: assetToBeSold,
            },
            {
                key: "isOpen",
                value: true
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

    sale = await searchOne(contractName, searchArgs, newOptions, user);

    if (!sale) {
        return undefined;
    }


    return marshalOut({
        ...sale,
    });
}

async function getSaleHistory(user, args, options) {
    const { contract, transaction_hash } = args;
    
    const newOptions = { ...options, org: undefined, app: undefined }
    let historySale = await searchAllWithQueryArgs(`history@${contract}`, {transaction_hash: transaction_hash}, newOptions, user);
        
  
    if (!historySale) {
      return undefined;
    }
  
    return marshalOut({
      ...historySale,
    });
  }

async function getAll(admin, args = {}, defaultOptions) {
    const { saleAddresses, assetAddresses, isOpen, range, ...restArgs } = args;
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }
    let sales;
    if (assetAddresses) {
        sales = await searchAllWithQueryArgs(contractName, {
            assetToBeSold: assetAddresses,
            isOpen: isOpen,
            range: range
        }, options, admin);
    }
    else {
        sales = await searchAllWithQueryArgs(contractName, { address: saleAddresses, isOpen: isOpen, ...restArgs }, options, admin);
    }

    return sales ? sales.map((sale) => marshalOut(sale)) : undefined;
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
    getSaleHistory
}
