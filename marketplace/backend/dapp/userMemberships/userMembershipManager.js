import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import userMembershipJs from './userMembership'
import userMembershipRequestJs from './userMembershipRequest'
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '../../helpers/utils';



const contractName = 'UserMembershipManager'
const contractFilename = `${util.cwd}/dapp/userMemberships/contracts/UserMembershipManager.sol`

async function uploadContract(admin, args = {}, options) {

  const source = await importer.combine(contractFilename)
  const contractArgs = {
    name: contractName,
    source,
    args: util.usc(args),
  }

  const contract = await rest.createContract(admin, contractArgs, options)
  contract.src = 'removed'

  return bind(admin, contract, options)
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
  contract.createUserMembership = async function (args, options = contractOptions) {
    return createUserMembership(admin, contract, args, options)
  }
  contract.updateUserMembership = async function (args, options = contractOptions) {
    return updateUserMembership(admin, contract, args, options)
  }
  contract.createUserMembershipRequest = async function (args, options = contractOptions) {
    return createUserMembershipRequest(admin, contract, args, options)
  }
  contract.getAllUserMembershipRequest = async function (args, options = contractOptions) {
    return getAllUserMembershipRequest(admin, args, options)
  }
  contract.updateUserMembershipRequest = async function (args, options = contractOptions) {
    return updateUserMembershipRequest(admin, contract, args, options)
  }
  contract.createUserMembershipAndPermissions = async function (args, options = contractOptions) {
    return createUserMembershipAndPermissions(admin, contract, args, options)
  }

  contract.getUserMembershipRequest = async function (args, options = contractOptions) {
    return userMembershipRequestJs.get(admin, args, options);
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
  const { role, address, ...restArgs } = args
  let userMembership

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address })
    userMembership = await searchOne(userMembershipJs.contractName, searchArgs, options, admin)
  }
  else {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'role', value: role })
    userMembership = await searchOne(userMembershipJs.contractName, searchArgs, options, admin)
  }
  if (!userMembership) {
    return undefined
  }
  return userMembershipJs.marshalOut(userMembership)
}

async function getAll(admin, args = {}, options) {
  const { chainIds, ...restArgs } = args

  const userMemberships = await searchAllWithQueryArgs(userMembershipJs.contractName, restArgs, options, admin)
  return userMemberships.map((userMembership) => userMembershipJs.marshalOut(userMembership))
}

async function createUserMembership(admin, contract, _args, baseOptions) {

  const args = userMembershipJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createUserMembership',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [userMembershipJs.contractName],
  }

  const [restStatus, userMembershipAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, userMembershipAddress];
}

async function createUserMembershipAndPermissions(admin, contract, _args, baseOptions) {

  const args = userMembershipJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createUserMembershipAndPermissions',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [userMembershipJs.contractName],
  }

  const [restStatus, userMembershipAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, userMembershipAddress];
}

async function updateUserMembership(admin, contract, _args, baseOptions) {
  const args = userMembershipJs.marshalIn(_args)

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1
    switch (key) {
      case 'isAdmin':
        return agg | (base << 0)
      case 'isTradingEntity':
        return agg | (base << 1)
      case 'isCertifier':
        return agg | (base << 2)
      default:
        return agg
    }
  }, 0)

  const callArgs = {
    contract,
    method: 'updateUserMembership',
    args: util.usc({
      scheme,
      ...args
    }),
  }

  const options = {
    ...baseOptions,
    history: [contractName],
  }

  const [restStatus, userMembershipAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, userMembershipAddress];
}

async function updateUserMembershipRequest(admin, contract, _args, baseOptions) {
const args = {userMembershipRequestAddress:'',userMembershipEvent:1,..._args}

  const callArgs = {
    contract,
    method: 'updateUserMembershipRequest',
    args: util.usc({
      ...args
    }),
  }

  const options = {
    ...baseOptions,
    history: [contractName],
  }

  const [restStatus, userMembershipState] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, userMembershipState];
}


async function createUserMembershipRequest(admin, contract, _args, baseOptions) {
  const args = userMembershipRequestJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createUserMembershipRequest',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [userMembershipRequestJs.contractName],
  }

  const [restStatus, userMembershipRequestAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, userMembershipRequestAddress];
}

async function getAllUserMembershipRequest(admin, args = {}, options) {
  const { chainIds, ...restArgs } = args
  const userMembershipRequests = await searchAllWithQueryArgs(userMembershipRequestJs.contractName, restArgs, options, admin)
  return userMembershipRequests.map((userMembershipRequest) => userMembershipRequestJs.marshalOut(userMembershipRequest))
}

export default {
  uploadContract,
  bind,
  bindAddress,
  get,
  getAll,
  contractName
}