import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
import dayjs from 'dayjs';


const contractName = 'UserMembershipRequest';
const contractFilename = `${util.cwd}/dapp/userMemberships/contracts/UserMembershipRequest.sol`;

/** 
 * Upload a new UserMembershipRequest
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of userMembershipRequest's constructor
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
 * As our arguments come into the userMembershipRequest contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        userAddress: '',
        state: 1,
        roles:[1],
        createdDate:Date.now(),
        owner:''
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
 * As our arguments come into the userMembershipRequest contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for userMembershipRequest to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options UserMembershipRequest deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address, }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.update = async (args) => update(user, contract, args, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing UserMembershipRequest contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new userMembershipRequest contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the UserMembership contract
 * @param options UserMembershipRequest deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address .
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const {  address, ...restArgs } = args;
    let userMembership;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        userMembership = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueCategoryID', value: uniqueCategoryID });
        userMembership = await searchOne(contractName, searchArgs, options, user);
    }
    if (!userMembership) {
        return undefined;
    }


    return marshalOut({ ...userMembership, 
    });
}

async function getAll(admin, args = {}, options) {
    const userMemberships = await searchAllWithQueryArgs(contractName, args, options, admin)
    return userMemberships.map((userMembership) => marshalOut(userMembership))
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
    const state = await rest.getState(user, contract, options);
    return marshalOut(state);
}

/**
 * Update UserMembershipRequest
 */
async function update(admin, contract, _args, baseOptions) {
    const args = marshalIn(_args)
  
    const scheme = Object.keys(_args).reduce((agg, key) => {
      const base = 1
      switch (key) {
        case 'role':
          return agg | (base << 0)
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
  
    const options = {
      ...baseOptions,
      history: [contractName],
    }
  
    const [restStatus, userMembershipRequestAddress] = await rest.call(admin, callArgs, options)
  
    if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })
  
    return [restStatus, userMembershipRequestAddress];
  }



export default {
    uploadContract,
    contractName,
    contractFilename,
    bindAddress,
    get,
    getAll,
    update,
    marshalIn,
    marshalOut,
    getHistory
}