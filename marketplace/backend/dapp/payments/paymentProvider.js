import { util, rest, importer } from '/blockapps-rest-plus';
// import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, search, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
// import dayjs from 'dayjs';


const contractName = 'BasePaymentProvider';
const stripeContractName = 'StripePaymentProvider';
const paymentContractName = 'StripePaymentProvider.StripePaymentInitialized';
const contractFilename = `${util.cwd}/dapp/mercata-base-contracts/Templates/Payments/StripePaymentProvider.sol`;

/** 
 * Upload a new PaymentProvider 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of PaymentProvider's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_) 
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
    const constructorArgs = marshalIn(_constructorArgs);

    const contractArgs = {
        name: stripeContractName,
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
 * As our arguments come into the paymentProvider contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        name: 1,
        accountId: '',
        accountLinked: true,
        status: '',
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
 * As our arguments come into the paymentProvider contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for paymentProvider to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options PaymentProvider deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * Bind an existing PaymentProvider contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new paymentProvider contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the PaymentProvider contract
 * @param options PaymentProvider deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniquePaymentProviderID.
 * @returns Contract state in cirrus
 */



async function get(user, args, defaultOptions) {
    const { ownerCommonName, name, address, accountId, accountDeauthorized, ...restArgs } = args;
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }
    let paymentProvider;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, [{ key: 'address', value: address }, {key: 'order', value: 'chargesEnabled.desc,block_timestamp.desc'}]);
        paymentProvider = await search(contractName, searchArgs, options, user);
    } else if (ownerCommonName) {
        let searchValues = [{ key: 'ownerCommonName', value: ownerCommonName }, { key: 'name', value: name }, {key: 'order', value: 'chargesEnabled.desc,block_timestamp.desc'}];
        if (accountDeauthorized != undefined) {
            searchValues.push({ key: 'accountDeauthorized', value: accountDeauthorized })
        }
        const searchArgs = setSearchQueryOptions(restArgs, searchValues);
        paymentProvider = await search(contractName, searchArgs, options, user);
    } else if (accountId) {

        const searchArgs = setSearchQueryOptions(restArgs, [{ key: 'accountId', value: accountId }, { key: 'name', value: name }, {key: 'order', value: 'chargesEnabled.desc,block_timestamp.desc'}]);
        paymentProvider = await search(contractName, searchArgs, options, user);
    }
    if (!paymentProvider) {
        return [];
    }

    return paymentProvider.map((p) => marshalOut({ ...p, }));
}

async function getAll(admin, args = {}, options) {
    const paymentProviders = await searchAllWithQueryArgs(contractName, args, options, admin);
    return paymentProviders.map((paymentProvider) => marshalOut(paymentProvider));
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
    const state = await rest.getState(user, contract, options);
    return marshalOut(state);
}

async function getPaymentSession(user, args, defaultOptions) {
    const { paymentSessionId, ...restArgs } = args;
    const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'paymentSessionId', value: paymentSessionId });
    const paymentProvider = await searchOne(paymentContractName, searchArgs, options, user);

    return marshalOut({ ...paymentProvider, });
}


async function createPayment(user, args, options) {
    const { address, ...restArgs } = args;
    const contract = { name: stripeContractName, address }
    const callArgs = {
      contract,
      method: "initializePayment",
      args: util.usc({ ...restArgs }),
    };
    const createStatus = await rest.call(user, callArgs, options);
  
    if (parseInt(createStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(
        createStatus,
        "You cannot initialize the payment because it's already been initialized",
        { callArgs }
      );
    }
  
    return createStatus;
}

async function finalizePayment(user, args, options) {
    const { address, ...restArgs } = args;
    const contract = { name: stripeContractName, ..._contract }
    const callArgs = {
      contract,
      method: "finalizePayment",
      args: util.usc({ ...restArgs }),
    };
    const finalizeStatus = await rest.call(user, callArgs, options);
  
    if (parseInt(finalizeStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(
        finalizeStatus,
        "You cannot finalize the payment because it isn't active",
        { callArgs }
      );
    }
  
    return finalizeStatus;
}

export default {
    uploadContract,
    contractName,
    stripeContractName,
    contractFilename,
    bindAddress,
    get,
    getAll,
    getState,
    marshalIn,
    marshalOut,
    getHistory,
    getPaymentSession,
    createPayment,
    finalizePayment
}