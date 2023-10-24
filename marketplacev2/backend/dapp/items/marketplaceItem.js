import { util, rest, importer } from '/blockapps-rest-plus';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAllWithQueryArgs, setSearchQueryOptionsPrime } from '/helpers/utils';
import dayjs from 'dayjs';


const contractName = 'MarketplaceItem';
const contractFilename = `${util.cwd}/dapp/items/contracts/MarketplaceItem.sol`;
const contractEvents = { OWNERSHIP_UPDATE: "OwnershipUpdate" }

/** 
 * Upload a new MarketplaceItem 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of MarketplaceItem's constructor
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
 * As our arguments come into the marketplaceItem contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        owner: '',
        productId: '',
        inventoryId: '',
        serialNumber: '',
        comment: '',
        itemNumber: 0,
        createdDate: 0,
        itemStatus: 1,
        uniqueProductCode: '',
        rawMaterialProductName: [''],
        rawMaterialSerialNumber: [''],
        rawMaterialProductId: [''],
        availableQuantity: 0,
        batchId: '',
        category: '',
        pricePerUnit: 0,
        quantity: 0,
        inventoryStatus: 1,
        subCategory: '',
        inventoryType: '',
        name: '',
        description: '',
        manufacturer: '',
        unitOfMeasurement: 1,
        userUniqueProductCode: '',
        leastSellableUnit: 0,
        imageKey: '',
        isActive: false,
        isDeleted: false,
        isInventoryAvailable: false
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
 * As our arguments come into the marketplaceItem contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for marketplaceItem to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options MarketplaceItem deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address, }) => get(user, args, options);
    contract.transferOwnership = async (newOwner) => transferOwnership(user, contract, options, newOwner);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing MarketplaceItem contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new marketplaceItem contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the MarketplaceItem contract
 * @param options MarketplaceItem deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
    let marketplaceItem;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        marketplaceItem = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueItemID', value: uniqueItemID });
        marketplaceItem = await searchOne(contractName, searchArgs, options, user);
    }
    if (!marketplaceItem) {
        return undefined;
    }

    return marshalOut({
        ...marketplaceItem,
    });
}

async function getAll(admin, args = {}, options) {
    const items = await searchAllWithQueryArgs(contractName, args, options, admin)
    return items.map((marketplaceItem) => marshalOut(marketplaceItem))
}

async function count(admin, args = {}, options) {
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
        sort: undefined,
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
 * Transfer the ownership of a MarketplaceItem
 * @param newOwner The organization address of the new owner of the MarketplaceItem.
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
        throw new rest.RestError(transferStatus, 'You cannot transfer the ownership of a MarketplaceItem you don\'t own', { newOwner })
    }

    return transferStatus
}

async function getAllOwnershipEvents(admin, args = {}, options) {
    const itemOwnershipEvents = await searchAllWithQueryArgs(`${contractName}.${contractEvents.OWNERSHIP_UPDATE}`, args, options, admin)
    return itemOwnershipEvents.map((marketplaceItem) => marshalOut(marketplaceItem))
}

export default {
    uploadContract,
    contractName,
    contractFilename,
    bindAddress,
    get,
    getAll,
    count,
    getAllOwnershipEvents,
    transferOwnership,
    marshalIn,
    marshalOut,
    getHistory
}
