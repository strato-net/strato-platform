import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs, setSearchQueryOptionsPrime } from '/helpers/utils';
import dayjs from 'dayjs';
import constants from '../../helpers/constants';
import saleJs from "../orders/sale";

const contractName = constants.assetTableName;
const contractFilename = `${util.cwd}/dapp/products/contracts/Inventory.sol`;

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
        status: 0
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

async function resellItem(user, contract, args, options) {
    const callArgs = {
      contract,
      method: "createSales",
      args: util.usc({ ...args }),
    };
    const resellStatus = await rest.call(user, callArgs, options);
  
    if (parseInt(resellStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(
        resellStatus,
        "You cannot resell the item because it's already published",
        { callArgs }
      );
    }
  
    return resellStatus;
}

async function updateInventory(user, contract, args, options) {
    const callArgs = {
      contract,
      method: "update",
      args: util.usc({ ...args }),
    };
    console.log("callArgs", callArgs)
    const resellStatus = await rest.call(user, callArgs, options);
  
    if (parseInt(resellStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(
        resellStatus,
        "You cannot resell the item because it's already published",
        { callArgs }
      );
    }
  
    return resellStatus;
}

/**
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args Lookup with an address or uniqueInventoryID.
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
    const { address, ...restArgs } = args;
    let inventory;

    const searchArgs = setSearchQueryOptions(restArgs, {
        key: "address",
        value: address,
    });
    inventory = await searchOne(contractName, searchArgs, options, user);

    if (!inventory) {
        return undefined;
    }

    const sale = await saleJs.get(user, { assetToBeSold: inventory.address, state: 1 }, options);

    if (sale) {
        inventory = {
            ...inventory,
            price: sale.price,
        }
    }

    return marshalOut({
        ...inventory,
    });
}

async function getAll(admin, args = {}, options) {
    const { range, ownerCommonName, assetAddresses, status, ...restArgs } = args;
    let inventories;
    let sales;
    let finalInventory = [];

    if (ownerCommonName) {
        inventories = await searchAllWithQueryArgs(contractName, 
            {   
                ...restArgs,
                ownerCommonName: ownerCommonName, 
                status: status ? status : [1,2],
            }, options, admin);
    }
    else if (assetAddresses) {
        inventories = await searchAllWithQueryArgs(contractName, 
            { 
                ...restArgs,
                address: assetAddresses, 
                status: status ? status : [1, 2],
            }, options, admin);
    }
    else {
        inventories = await searchAllWithQueryArgs(contractName, 
            { 
                ...restArgs, 
                status: status ? status : [1,2],
            }, options, admin);
    }

    if (inventories) {
        const assetAddresses = inventories.map((inventory) => inventory.address);
        sales = await saleJs.getAll(admin, { assetAddresses }, options);
        inventories.forEach(inventory => {
            const itemSale = sales.find(sale => sale.assetToBeSold == inventory.address);
            if (itemSale) {
                finalInventory.push({
                    ...inventory,
                    price: itemSale?.price,
                })
            } else {
                finalInventory.push(inventory);
            }
        });
    }

    return finalInventory ? finalInventory.map((inventory) => marshalOut(inventory)) : undefined;
}

async function inventoryCount(admin, args = {}, options) {
    const queryArgs = setSearchQueryOptionsPrime({
        ...args,
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
        select: "count",
        },
    },
    options,
    admin
    );

    return totalResult[0].count
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
    contractName,
    contractFilename,
    bindAddress,
    resellItem,
    updateInventory,
    get,
    getAll,
    inventoryCount,
    marshalIn,
    marshalOut,
    getHistory
}
