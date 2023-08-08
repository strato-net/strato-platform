import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgsLike, setSearchQueryOptionsPrime } from '/helpers/utils';
import dayjs from 'dayjs';


const contractName = 'Service';
const contractFilename = `${util.cwd}/dapp/assets/Service/contracts/Service.sol`;

/** 
 * Upload a new Service 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Service's constructor
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
 * As our arguments come into the service contract they first pass through `marshalIn` and 
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
        price: 0,
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
 * As our arguments come into the service contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for service to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Service deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address, }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.transferOwnership = async (newOwner) => transferOwnership(user, contract, options, newOwner);
    contract.update = async (args) => update(user, contract, args, options);
    contract.addOrg = async  (orgName) => addOrg(user, contract, options, orgName);
    contract.addOrgUnit = async  (orgName, orgUnit) => addOrgUnit(user, contract, options, orgName, orgUnit);
    contract.addMember = async  (orgName, orgUnit, commonName) => addMember(user, contract, options, orgName, orgUnit, commonName);
    contract.removeOrg = async  (orgName) => removeOrg(user, contract, options, orgName);
    contract.removeOrgUnit = async  (orgName, orgUnit) => removeOrgUnit(user, contract, options, orgName, orgUnit);
    contract.removeMember = async (orgName, orgUnit, commonName) => removeMember(user, contract, options, orgName, orgUnit, commonName);
    contract.addOrgs = async (orgNames) => addOrgs(user, contract, options, orgNames);
    contract.addOrgUnits = async (orgNames, orgUnits) => addOrgUnits(user, contract, options, orgNames, orgUnits);
    contract.addMembers = async (orgNames, orgUnits, commonNames) => addMembers(user, contract, options, orgNames, orgUnits, commonNames);
    contract.removeOrgs = async (orgNames) => removeOrgs(user, contract, options, orgNames);
    contract.removeOrgUnits = async (orgNames, orgUnits) => removeOrgUnits(user, contract, options, orgNames, orgUnits);
    contract.removeMembers = async (orgNames, orgUnits, commonNames) => removeMembers(user, contract, options, orgNames, orgUnits, commonNames);
    contract.getMembers = async () => getMembers(user, contract, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing Service contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new service contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Service contract
 * @param options Service deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueServiceID.
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const { uniqueServiceID, address, ...restArgs } = args;
    let service;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        service = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueServiceID', value: uniqueServiceID });
        service = await searchOne(contractName, searchArgs, options, user);
    }
    if (!service) {
        return undefined;
    }


    return marshalOut({ ...service, 
    });
}

async function getAll(admin, args = {}, options) {
    const services = await searchAllWithQueryArgsLike(contractName, args, options, admin)

    const queryArgs = setSearchQueryOptionsPrime(
        {
          ...args,
          limit: undefined,
          offset: 0
        }
    )

    const totalResult = await searchAll(
        contractName,
        {
          ...queryArgs,
          sort: undefined, // can't sort and count together or postgres complains (redundant anyway)
          queryOptions: {
            ...queryArgs.queryOptions,
            select: 'count'
          },
        },
        options,
        admin,
      )

    return { services: services.map((service) => marshalOut(service)), total: totalResult[0].count}
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
 * Update Service
 */
async function update(admin, contract, _args, baseOptions) {
    const args = marshalIn(_args)
  
    const scheme = Object.keys(_args).reduce((agg, key) => {
      const base = 1
      switch (key) {
        case 'name':
          return agg | (base << 0)
        case 'description':
          return agg | (base << 1)
        case 'price':
          return agg | (base << 2)
        case 'createdDate':
          return agg | (base << 3)
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
  
    const [restStatus, ServiceAddress] = await rest.call(admin, callArgs, options)
  
    if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })
  
    return [restStatus, ServiceAddress];
  }

export default {
    uploadContract,
    contractName,
    contractFilename,
    bindAddress,
    get,
    getAll,
    transferOwnership,
    update,
    marshalIn,
    marshalOut,
    getHistory
}
