import { util, rest, importer } from '/blockapps-rest-plus';
// import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
// import dayjs from 'dayjs';


const contractName = 'UserAddress';
const contractFilename = `${util.cwd}/dapp/addresses/contracts/UserAddress.sol`;

/** 
 * Upload a new UserAddress 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of UserAddress's constructor
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
 * As our arguments come into the userAddress contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        name: '',  
        shippingName: '',
        shippingZipcode: '',
        shippingState: '',
        shippingCity: '',
        shippingAddressLine1: '',
        shippingAddressLine2: '',
        billingName: '',
        billingZipcode: '',
        billingState: '',
        billingCity: '',
        billingAddressLine1: '',
        billingAddressLine2: '',
        createdDate: 0,
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
 * As our arguments come into the userAddress contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for userAddress to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options UserAddress deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address, }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.getMembers = async () => getMembers(user, contract, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing UserAddress contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new userAddress contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the UserAddress contract
 * @param options UserAddress deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueUserAddressID.
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const { uniqueUserAddressID, address, ...restArgs } = args;
    let userAddress;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        userAddress = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueUserAddressID', value: uniqueUserAddressID });
        userAddress = await searchOne(contractName, searchArgs, options, user);
    }
    if (!userAddress) {
        return undefined;
    }

    return marshalOut({ ...userAddress, });
}

async function getAll(admin, args = {}, options) {
    const userAddress = await searchAllWithQueryArgs(
      contractName,
      args,
      options,
      admin
    );
    return userAddress.map((order) => marshalOut(order));
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
    getState,
    marshalIn,
    marshalOut,
    getHistory
}
