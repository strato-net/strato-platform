import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import serviceJS from './service'
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils'
import { service } from '../../api/v1/endpoints';

const contractName = 'Mem_ServiceManager_10'
const contractFilename = `${util.cwd}/dapp/service/contracts/serviceManager.sol`

async function uploadContract(user, _constructorArgs = {}, options) {
  // const constructorArgs = marshalIn(_constructorArgs);

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
    createdDate: 0,
    appChainId: '',
  };

  const args = {
    ...defaultArgs,
    ..._args,
  };
  return args;
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

function bind(admin, _contract, contractOptions) {
  const contract = {
    ..._contract,
  }

  contract.get = async function (args, options = contractOptions) {
    return get(admin, args, options)
  }
  contract.getAll = async function (args, options = contractOptions) {
    return getAll(admin, args, options)
  }
  contract.createService = async function (args, options = contractOptions) {
    return createService(admin, contract, args, options)
  }
  return contract
}

function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  }
  return bind(user, contract, options)
}

async function get(admin, args, options) {
  return serviceJS.get(admin, args, options);
}

async function getAll(admin, args, options) {
  return serviceJS.getAll(admin, args, options);
}

async function createService(admin, contract, _args, baseOptions) {
  const args = serviceJS.marshalIn(_args)
  const callArgs = {
    contract,
    method: 'createService',
    args: util.usc(args),

  }
  const options = {
    ...baseOptions,
    history: [contractName],
  }

  const [restStatus, serviceAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, serviceAddress]
}

export default {
  contractName,
  contractFilename,
  uploadContract,
  bind,
  bindAddress,
  get,
  getAll,
  createService,
}