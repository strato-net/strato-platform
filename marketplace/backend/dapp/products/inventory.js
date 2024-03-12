import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs, setSearchQueryOptionsPrime, waitForAddress } from '/helpers/utils';
import dayjs from 'dayjs';
import constants from '../../helpers/constants';
import saleJs from "../orders/sale";

const contractName = constants.assetTableName;
const transferContractName = `${contractName}.ItemTransfers`;
const contractFilename = `${util.cwd}/dapp/products/contracts/Inventory.sol`;
const saleContractName = 'SimpleSale';
const saleContract = constants.saleTableName;
const saleContractFilename = `${util.cwd}/dapp/mercata-base-contracts/Templates/Sales/SimpleSale.sol`;
const contractEvents = { ITEM_TRANSFER: "ItemTransfers" }

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

async function uploadSaleContract(user, _constructorArgs, options) {

    const contractArgs = {
        name: saleContractName,
        source: await importer.combine(saleContractFilename),
        args: util.usc(_constructorArgs),
    };

    let error = [];

    if (error.length) {
        throw new Error(error.join('\n'));
    }

    const copyOfOptions = {
        ...options,
        history: saleContractName
    }

    const contract = await rest.createContract(user, contractArgs, copyOfOptions);
    contract.src = 'removed';
    
    const searchOptions = {
        ...options,
        org: constants.blockAppsOrg,
        query: {
            address: `eq.${contract.address}`
        }
      }
      
    await waitForAddress(user, {name: saleContract}, searchOptions);
    
    return contract;
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
    contract.checkSaleQuantity = async (args) => checkSaleQuantity(user, args, options)
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

async function unlistItem(user, _contract, args, options) {
    const contract = { name: saleContractName, ..._contract }
    const callArgs = {
        contract,
        method: "closeSale",
        args: util.usc({ ...args }),
    };
    const unlistStatus = await rest.call(user, callArgs, options);

    if (parseInt(unlistStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
            unlistStatus,
            "You cannot unlist the item because it's already published",
            { callArgs }
        );
    }
    
    const searchOptions = {
        ...options,
        org: constants.blockAppsOrg,
        query: {
            address: `eq.${callArgs.contract.address}`,
            isOpen: `eq.false`
        }
      }
      
    await waitForAddress(user, {name: saleContract}, searchOptions);
    
    return unlistStatus;
}

async function resellItem(user, contract, args, options) {
    const callArgs = {
        contract,
        method: "mintNewUnits",
        args: util.usc({ ...args }),
    };
    
    const resellStatus = await rest.call(user, callArgs, options);

    if (parseInt(resellStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
            resellStatus,
            "You cannot resell the item because it has already been sold by the original owner.",
            { callArgs }
        );
    }
    
    return resellStatus;
}

async function transferItem(user, contract, args, options) {
    const callArgs = {
        contract,
        method: "automaticTransfer",
        args: util.usc({ ...args }),
    };
    const transferStatus = await rest.call(user, callArgs, options);

    if (parseInt(transferStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
            transferStatus,
            "You cannot transfer the item",
            { callArgs }
        );
    }
    
    const searchOptions = {
        ...options,
        org: constants.blockAppsOrg,
        query: {
            address: `eq.${callArgs.contract.address}`
        }
      }
      
    await waitForAddress(user, {name: transferContractName}, searchOptions);

    return transferStatus;
}

async function updateInventory(user, contract, args, options) {
    const callArgs = {
        contract,
        method: "update",
        args: util.usc({ ...args.updates }),
    };

    const resellStatus = await rest.call(user, callArgs, options);

    if (parseInt(resellStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
            resellStatus,
            "You cannot update the item",
            { callArgs }
        );
    }

    return resellStatus;
}

async function updateSale(admin, contract, _args, options) {
    // const args = paymentJs.marshalIn(_args)
    const args = { ..._args }
    const scheme = Object.keys(_args).reduce((agg, key) => {
        const base = 1
        switch (key) {
            case 'quantity':
                return agg | (base << 0)
            case 'price':
                return agg | (base << 1)
            case 'paymentProviders':
                return agg | (base << 2)
            default:
                return agg
        }
    }, 0)

    const callArgs = {
        contract,
        method: 'update',
        args: util.usc({
            scheme,
            ...args
        }),
    }

    const restStatus = await rest.call(admin, callArgs, options)

    if (parseInt(restStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(restStatus, 0, { callArgs })
    }

    return restStatus;
}

/**
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args Lookup with an address or uniqueInventoryID.
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
    const { address, ...restArgs } = args;
    const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' }
    let inventory;

    const searchArgs = setSearchQueryOptions(restArgs, {
        key: "address",
        value: address,
    });
    inventory = await searchOne(contractName, searchArgs, newOptions, user);

    if (!inventory) {
        return undefined;
    }

    const sale = await saleJs.get(user, { assetToBeSold: inventory.address, isOpen: true }, newOptions);

    if (sale) {
        inventory = {
            ...inventory,
            price: sale.price,
            saleAddress: sale.address,
            saleQuantity: sale.quantity,
        }
    }

    return marshalOut({
        ...inventory,
    });
}

async function getAll(admin, args = {}, defaultOptions) {
    const { range, ownerCommonName, assetAddresses, status, isMarketplaceSearch, isTrendingSearch, userProfile, userProfileGtField, userProfileGtValue, ...restArgs } = args;
    let inventories;
    let sales;
    let finalInventory = [];
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };

    if (isTrendingSearch) {
        // If it's a trending search, first search the sales
        // Order them by creation date and set limit here

        // added greater than query to make sure we only take the sales with quantity thats available to sell. 
        // If the sale has 0 quantity it will throw an error when checking out, we will not show thee items for the trending search.
        sales = await saleJs.getAll(admin, { range, isOpen: true, order: 'block_timestamp.desc', limit: '25', offset: '0', gtField: args.gtField, gtValue: args.gtValue}, options);
        const trendingAssetAddresses = sales.map(sale => sale.assetToBeSold);

        // Match the inventory with the sales
        inventories = await searchAllWithQueryArgs(contractName,
            {
                address: trendingAssetAddresses,
            }, options, admin);
    } 
    else {
        // Original logic
        if (ownerCommonName) {
            inventories = await searchAllWithQueryArgs(contractName,
                {
                    ...restArgs,
                    ownerCommonName: ownerCommonName,
                }, options, admin);
        }
        else if (assetAddresses) {
            inventories = await searchAllWithQueryArgs(contractName,
                {
                    ...restArgs,
                    address: assetAddresses,
                }, options, admin);
        }
        else {
            inventories = await searchAllWithQueryArgs(contractName,
                {
                    ...restArgs,
                }, options, admin);
        }
        if (inventories && userProfile) {
            const assetAddresses = inventories.map((inventory) => inventory.address);
            // (sale.js): `getAll` method needs to be refactored as it has logic specific to passing `assetAddresses`
            sales = await saleJs.getAll(admin, {  assetAddresses, range, saleGtField: userProfileGtField, saleGtValue: userProfileGtValue, isOpen: true, order: 'block_timestamp.desc' }, options);
        }
        else if (inventories) {
            const assetAddresses = inventories.map((inventory) => inventory.address);
            sales = await saleJs.getAll(admin, { assetAddresses, range, isOpen: true }, options);
        }
    }

    if (inventories) {
        inventories.forEach(inventory => {
            const itemSale = sales.find(sale => sale.assetToBeSold == inventory.address && sale.isOpen);
            if (itemSale) {
                finalInventory.push({
                    ...inventory,
                    price: itemSale?.price,
                    saleAddress: itemSale?.address,
                    saleQuantity: itemSale?.quantity,
                    saleDate: itemSale?.block_timestamp,
                    totalLockedQuantity: itemSale?.totalLockedQuantity
                });
            }
            else if (isMarketplaceSearch) {
                //skip
            } else {
                finalInventory.push(inventory);
            }
        });
    }

    return finalInventory ? finalInventory.map((inventory) => marshalOut(inventory)) : undefined;
}


async function getAllItemTransferEvents(admin, args = {}, defaultOptions) {
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }
    let itemTransferEvents = await searchAllWithQueryArgs(`${contractName}.${contractEvents.ITEM_TRANSFER}`, args, options, admin);
    const itemAddressArr = itemTransferEvents.map(item => item.assetAddress)
    const itemsSale = await searchAllWithQueryArgs(`Sale`, { assetToBeSold: itemAddressArr }, options, admin);
    const total = await searchAllWithQueryArgs(`${contractName}.${contractEvents.ITEM_TRANSFER}`, { ...args, limit: undefined, offset: 0, order: undefined, queryOptions: { select: "count", } }, options, admin);
    itemTransferEvents = itemTransferEvents.map(item=>{
       const saleData = itemsSale.find((sale)=>sale.assetToBeSold === item.address)
       return {...item, price:saleData?.price }
    })
    return { transfers: itemTransferEvents.map((item) => marshalOut(item)), total: total[0]?.count };
}

async function getOwnershipHistory(user, args, options) {
    const { originAddress, minItemNumber, maxItemNumber } = args;
    const newOptions = { ...options, org: 'BlockApps', app: 'Mercata' }
    const searchArgs = {
        originAddress,
        gteField: 'maxItemNumber',
        gteValue: minItemNumber,
        lteField: 'minItemNumber',
        lteValue: maxItemNumber,
        sort: '+block_timestamp'
    };

    const history = await searchAllWithQueryArgs(`${contractName}.OwnershipTransfer`, searchArgs, newOptions, user);
    return history;
}

async function inventoryCount(admin, args = {}, defaultOptions) {
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }
    const { range, userProfile, userProfileGtField, userProfileGtValue, ...newArgs } = args;
    const queryArgs = setSearchQueryOptionsPrime({
        ...newArgs,
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

async function checkSaleQuantity(admin, args, defaultOptions) {
    const { saleAddresses, orderQuantity } = args; // Assuming orderQuantity here is used differently now
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };

    // Fetch sales and assets data
    const sales = await saleJs.getAll(admin, { address: saleAddresses }, options);
    const assets = await searchAllWithQueryArgs(contractName, { sale: saleAddresses }, options, admin);
    let insufficientDetails = [];

    sales.forEach((sale, index) => {
        const actualAvailableQuantity = sale.quantity; 
        const requestedQuantity = orderQuantity[index]; // Accessing requested quantity via sale address

        if (actualAvailableQuantity < requestedQuantity) {
            const asset = assets.find(asset => asset.sale === sale.address);
            if (asset) {
                insufficientDetails.push({
                    assetName: asset.name, 
                    assetAddress: sale.assetToBeSold,
                    availableQuantity: actualAvailableQuantity,
                });
            }
        }
    });

    if (insufficientDetails.length > 0) {
        return insufficientDetails;
    } else {
        // If all sales have sufficient quantities, return true
        return true;
    }
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
    uploadSaleContract,
    contractName,
    contractFilename,
    saleContractName,
    saleContractFilename,
    bindAddress,
    unlistItem,
    resellItem,
    transferItem,
    updateInventory,
    updateSale,
    checkSaleQuantity,
    get,
    getAll,
    getOwnershipHistory,
    getAllItemTransferEvents,
    inventoryCount,
    marshalIn,
    marshalOut,
    getHistory
}
