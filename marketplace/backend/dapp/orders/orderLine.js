import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
import dayjs from 'dayjs';


const contractName = 'OrderLine_2';
const contractFilename = `${util.cwd}/dapp/orders/contracts/OrderLine.sol`;

/** 
 * Upload a new OrderLine 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of OrderLine's constructor
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
 * As our arguments come into the orderLine contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        productId: 0,
        inventoryId: 0,
        quantity: 0,
        pricePerUnit: 0,
        tax: 0,
        shippingCharges: 0,
        createdDate: 0,
        orderAddress: 0
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
 * As our arguments come into the orderLine contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for orderLine to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options OrderLine deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address, }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.addOrderLineItems = async (args) => addOrderLineItems(user, contract, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing OrderLine contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new orderLine contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the OrderLine contract
 * @param options OrderLine deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueOrderLineID.
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const { uniqueOrderLineID, address, ...restArgs } = args;
    let orderLine;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        orderLine = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueOrderLineID', value: uniqueOrderLineID });
        orderLine = await searchOne(contractName, searchArgs, options, user);
    }
    if (!orderLine) {
        return undefined;
    }


    return marshalOut({
        ...orderLine,
    });
}

async function getAll(admin, args = {}, options) {
    const orderLines = await searchAllWithQueryArgs(contractName, args, options, admin)
    return orderLines.map((orderLine) => marshalOut(orderLine))
}

async function addOrderLineItems(admin, contract, _args, baseOptions) {
    const callArgs = {
        contract,
        method: 'addOrderLineItems',
        args: util.usc({
            ..._args
        }),
    }
    const options = {
        ...baseOptions,
        history: [contractName],
    }

    const [restStatus, orderLineItemAddress] = await rest.call(admin, callArgs, options)

    if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })

    return [restStatus, orderLineItemAddress];
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
    addOrderLineItems,
    marshalIn,
    marshalOut,
    getHistory
}