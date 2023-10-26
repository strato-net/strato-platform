import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs, setSearchQueryOptionsPrime } from '/helpers/utils';
import dayjs from 'dayjs';
import { ASSET_TABLE_NAME } from '../../helpers/constants';

const contractName = ASSET_TABLE_NAME ? ASSET_TABLE_NAME : "BlockApps-Dapp-Product_3";
const contractFilename = `${util.cwd}/dapp/products/contracts/Product.sol`;
/** 
 * Upload a new Product 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Product's constructor
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
 * As our arguments come into the product contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        name: '',
        description: '',
        manufacturer: '',
        unitOfMeasurement: '',
        uniqueProductCode: '',
        leastSellableUnit: 0,
        imageKey: '',
        isActive: false,
        category: '',
        subCategory: '',
        createdDate: 0
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
 * As our arguments come into the product contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for product to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Product deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing Product contract to a new user token. Useful for having multiple users test
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

/**
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args Lookup with an address or uniqueProductID.
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const { org, ...modifiedOptions } = options;
    const { uniqueProductID, address, ownerOrganization, offset, limit, ...restArgs } = args;
    let product;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        product = await searchOne(contractName, {"offset": offset, "limit": limit}, modifiedOptions, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueProductID', value: uniqueProductID });
        product = await searchOne(contractName, {"offset": offset, "limit": limit}, modifiedOptions, user);
    }
    if (!product) {
        return undefined;
    }


    return marshalOut({
        ...product,
    });
}

async function getAll(admin, args = {}, options) {
    const { org, ...modifiedOptions } = options;
    const { offset, limit, ...restArgs } = args; 
    const products = await searchAllWithQueryArgs(contractName, {"offset": offset, "limit": limit}, modifiedOptions, admin);
    return products.map((product) => marshalOut(product))
}

async function count(admin, args = {}, options) {
    const queryArgs = setSearchQueryOptionsPrime({
        limit: undefined,
        offset: 0,
        order: undefined,
    });

    const { org, ...modifiedOptions } = options;
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
    modifiedOptions,
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
    get,
    getAll,
    count,
    marshalIn,
    marshalOut,
    getHistory
}
