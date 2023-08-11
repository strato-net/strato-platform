import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
import dayjs from 'dayjs';


const contractName = 'MembershipService';
const contractFilename = `${util.cwd}/dapp/membershipService/contracts/MembershipService.sol`;

/** 
 * Upload a new MembershipService 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of MembershipService's constructor
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
 * As our arguments come into the membershipService contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        membershipId: '0',
        serviceId: '0',
        membershipPrice: 0,
        discountPrice: 0,
        maxQuantity: 0,
        createdDate: 0,
        isActive: false,
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
 * As our arguments come into the membershipService contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for membershipService to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options MembershipService deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address, }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.transferOwnership = async (newOwner) => transferOwnership(user, contract, options, newOwner);
    contract.update = async (args) => update(user, contract, args, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing MembershipService contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new membershipService contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the MembershipService contract
 * @param options MembershipService deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueMembershipServiceID.
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const { uniqueMembershipServiceID, address, ...restArgs } = args;
    let membershipService;

    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        membershipService = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueMembershipServiceID', value: uniqueMembershipServiceID });
        membershipService = await searchOne(contractName, searchArgs, options, user);
    }
    if (!membershipService) {
        return undefined;
    }


    return marshalOut({ ...membershipService, 
    });
}

async function getAll(admin, args = {}, options) {
    const membershipServices = await searchAllWithQueryArgs(contractName, args, options, admin)

    return { membershipServices: membershipServices.map((membershipService) => marshalOut(membershipService))}
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
 * Update MembershipService
 */
async function update(admin, contract, _args, baseOptions) {
    const args = marshalIn(_args)
  
    const scheme = Object.keys(_args).reduce((agg, key) => {
      const base = 1
      switch (key) {
        case 'membershipId':
          return agg | (base << 0)
        case 'serviceId':
          return agg | (base << 1)
        case 'membershipPrice':
          return agg | (base << 2)
        case 'discountPrice':
          return agg | (base << 3)
        case 'maxQuantity':
          return agg | (base << 4)
        case 'createdDate':
          return agg | (base << 5)
        case 'isActive':
          return agg | (base << 6)
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
  
    const [restStatus, MembershipServiceAddress] = await rest.call(admin, callArgs, options)
  
    if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })
  
    return [restStatus, MembershipServiceAddress];
  }

/**
 * Transfer the ownership of a MembershipService
 * @param newOwner The organization address of the new owner of the MembershipService.
 */
async function transferOwnership(user, contract, options, newOwner) {
    // they may tell us they want this date entered by the user, but we'll see
    const transferOwnershipDate = dayjs().unix();  

    const callArgs = {
      contract,
      method: 'transferOwnership',
      args: util.usc({ addr: newOwner}), // could be transferOwnershipDate
    };
    const transferStatus = await rest.call(user, callArgs, options);
  
    console.log('transferStatus', transferStatus);
    console.log(parseInt(transferStatus, 10));
    console.log(RestStatus.OK);
    if (parseInt(transferStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(transferStatus, 'You cannot transfer the ownership of a MembershipService you don\'t own', { newOwner })
    }
  
    return transferStatus
}

/**
 * Add a new organization to a membershipService contract/chain.
 * @param {string} orgName The new organization to add
 */
 async function addOrg(user, contract, options, orgName) {
    const callArgs = {
        contract,
        method: 'addOrg',
        args: util.usc({ orgName }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Add a new organization unit to a membershipService contract/chain.
 * @param {string} orgName The organization the unit to add belongs to
 * @param {string} orgUnit The new organization unit to add
 */
 async function addOrgUnit(user, contract, options, orgName, orgUnit) {
    const callArgs = {
        contract,
        method: 'addOrgUnit',
        args: util.usc({ orgName, orgUnit }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Add a new member to a membershipService contract/chain.
 * @param {string} orgName The organization the member to add belongs to
 * @param {string} orgUnit The organization unit the member to add belongs to
 * @param {string} commonName The common name of the member to add
 */
async function addMember(user, contract, options, orgName, orgUnit, commonName) {
    const callArgs = {
        contract,
        method: 'addMember',
        args: util.usc({ orgName, orgUnit, commonName }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization from a membershipService contract/chain.
 * @param {string} orgName The organization to remove
 */
 async function removeOrg(user, contract, options, orgName) {
    const callArgs = {
        contract,
        method: 'removeOrg',
        args: util.usc({ orgName }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization unit from a membershipService contract/chain.
 * @param {string} orgName The organization the unit to remove belongs to
 * @param {string} orgUnit The organization unit to remove
 */
 async function removeOrgUnit(user, contract, options, orgName, orgUnit) {
    const callArgs = {
        contract,
        method: 'removeOrgUnit',
        args: util.usc({ orgName, orgUnit }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Remove an existing member from a membershipService contract/chain.
 * @param {string} orgName The organization the member to remove belongs to
 * @param {string} orgUnit The organization unit the member to remove belongs to
 * @param {string} commonName The common name of the member to remove
 */
 async function removeMember(user, contract, options, orgName, orgUnit, commonName) {
    const callArgs = {
        contract,
        method: 'removeMember',
        args: util.usc({ orgName, orgUnit, commonName }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organizations to a membershipService contract/chain.
 * @param {string} orgNames An array of new organizations to add
 */
 async function addOrgs(user, contract, options, orgNames) {
    const callArgs = {
        contract,
        method: 'addOrgs',
        args: util.usc({ orgNames }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organization units to a membershipService contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of new organization units to add 
 */
 async function addOrgUnits(user, contract, options, orgNames, orgUnits) {
    const callArgs = {
        contract,
        method: 'addOrgUnits',
        args: util.usc({ orgNames, orgUnits }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Add multiple new members to a membershipService contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of organization units the members to add belongs to
 * @param {string} commonNames An array of the common names of the members to add
 */
 async function addMembers(user, contract, options, orgNames, orgUnits, commonNames) {
    const callArgs = {
        contract,
        method: 'addMembers',
        args: util.usc({ orgNames, orgUnits, commonNames }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organizations from a membershipService contract/chain.
 * @param {string[]} orgNames An array of organizations to remove
 */
 async function removeOrgs(user, contract, options, orgNames) {
    const callArgs = {
        contract,
        method: 'removeOrgs',
        args: util.usc({ orgNames }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organization units from a membershipService contract/chain.
 * @param {string[]} orgNames An array of organizations the units to remove belongs to
 * @param {string[]} orgUnits An array of organization units to remove
 */
 async function removeOrgUnits(user, contract, options, orgNames, orgUnits) {
    const callArgs = {
        contract,
        method: 'removeOrgUnits',
        args: util.usc({ orgNames, orgUnits }),
    };
    return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing members from a membershipService contract/chain.
 * @param {string[]} orgNames An array of organizations the units to remove belongs to
 * @param {string[]} orgUnits An array of organization units the members to remove belongs to
 * @param {string[]} commonNames An array of the common names of the members to remove
 */
 async function removeMembers(user, contract, options, orgNames, orgUnits, commonNames) {
    const callArgs = {
        contract,
        method: 'removeMembers',
        args: util.usc({ orgNames, orgUnits, commonNames }),
    };
    return rest.call(user, callArgs, options);
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
