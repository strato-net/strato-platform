import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import eventTypeJS from './eventType'
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils'
import { EventType } from '../../api/v1/endpoints';

const contractName = 'EventTypeManager_10'
const contractFilename = `${util.cwd}/dapp/eventType/contracts/EventTypeManager.sol`

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
 * As our arguments come into the eventType contract they first pass through `marshalIn` and 
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
 * As our arguments come into the eventType contract they first pass through {@link marshalIn `marshalIn`} 
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
  contract.createEventType = async function (args, options = contractOptions) {
    return createEventType(admin, contract, args, options)
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
  const { uniqueEventTypeId, address, ...restArgs } = args
  let eventType

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address })
    eventType = await searchOne(eventTypeJS.contractName, searchArgs, options, admin)
  }
  else {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueEventTypeId', value: uniqueEventTypeId })
    eventType = await searchOne(eventTypeJS.contractName, searchArgs, options, admin)
  }
  if (!eventType) {
    return undefined
  }
  return eventTypeJS.marshalOut(eventType)
}

async function getAll(admin, args = {}, options) {
  const eventTypes = await searchAllWithQueryArgs(eventTypeJS.contractName, args, options, admin)
  return eventTypes.map((eventType) => eventTypeJS.marshalOut(eventType))
}

async function createEventType(admin, contract, _args, baseOptions) {
  const args = eventTypeJS.marshalIn(_args)
  const callArgs = {
    contract,
    method: 'createEventType',
    args: util.usc(args),

  }
  const options = {
    ...baseOptions,
    history: [contractName],
  }
  const [restStatus, EventTypeAddress] = await rest.call(admin, callArgs, options)
  if (parseInt(restStatus) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, EventTypeAddress]
}

export default {
  contractName,
  contractFilename,
  uploadContract,
  bind,
  bindAddress,
  get,
  getAll,
  createEventType,
}