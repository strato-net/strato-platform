import { importer, rest, util } from '/blockapps-rest-plus'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import networkOnboardingUserJs from './networkOnboardingUser'
import { setSearchQueryOptions, searchOne, searchAll } from '/helpers/utils'

const contractName = 'NetworkOnboardingUserManager'
const contractFilename = `${util.cwd}/${config.dappPath}/user/contracts/NetworkOnboardingUserManager.sol`

async function uploadContract(user, args, options) {
  console.log("HERE11");
  const source = await importer.combine(contractFilename)
  const contractArgs = {
    name: contractName,
    source,
    args: util.usc(args),
  }
  console.log("HERE22");
  console.log(JSON.stringify(contractArgs));
  const contract = await rest.createContract(user, contractArgs, options)
  contract.src = 'removed'
  console.log("HERE33");
  return bind(user, contract, options)
}

function bind(user, _contract, contractOptions) {
  const contract = _contract

  contract.getState = async function (options = contractOptions) {
    return rest.getState(user, contract, options)
  }
  contract.get = async function (args, options = contractOptions) {
    return get(user, args, options)
  }
  contract.getByUsername = async function (args, options = contractOptions) {
    return getByUsername(user, args, options)
  }
  contract.getByOrganization = async function (args, options = contractOptions) {
    return getByOrganization(user, args, options)
  }
  contract.getAll = async function (args, options = contractOptions) {
    return getAll(user, args, options)
  }
  contract.createUser = async function (args, options = contractOptions) {
    return createUser(user, contract, args, options)
  }
  contract.setUserOrganization = async function (args, options = contractOptions) {
    return setUserOrganization(user, contract, args, options)
  }
  contract.setUserBlockchainAddress = async function (args, options = contractOptions) {
    return setUserBlockchainAddress(user, contract, args, options)
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
  const { blockchainAddress, username, ...restArgs } = args
  if (!blockchainAddress) {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'username', value: username })
    const networkOnboardingUser = await searchOne(networkOnboardingUserJs.contractName, searchArgs, options, admin)
    if (!networkOnboardingUser) {
      return undefined
    }
    return networkOnboardingUserJs.marshalOut(networkOnboardingUser)
  }

  const searchArgs = setSearchQueryOptions(restArgs, { key: 'blockchainAddress', value: blockchainAddress })
  const networkOnboardingUser = await searchOne(networkOnboardingUserJs.contractName, searchArgs, options, admin)
  if (!networkOnboardingUser) {
    return undefined
  }
  return networkOnboardingUserJs.marshalOut(networkOnboardingUser)
}

async function getByUsername(admin, args, options) {
  const { username, ...restArgs } = args
  const searchArgs = setSearchQueryOptions(restArgs, { key: 'username', value: username })
  const networkOnboardingUser = await searchOne(networkOnboardingUserJs.contractName, searchArgs, options, admin)
  if (!networkOnboardingUser) {
    return undefined
  }
  return networkOnboardingUserJs.marshalOut(networkOnboardingUser)
}

async function getByOrganization(admin, args, options) {
  const { organization, ...restArgs } = args
  const searchArgs = setSearchQueryOptions(restArgs, { key: 'organization', value: organization })
  const networkOnboardingUser = await searchOne(networkOnboardingUserJs.contractName, searchArgs, options, admin)
  if (!networkOnboardingUser) {
    return undefined
  }
  return networkOnboardingUserJs.marshalOut(networkOnboardingUser)
}

async function getAll(admin, args = {}, options) {
  const results = await searchAll(networkOnboardingUserJs.contractName, args, options, admin)
  return results.map((result) => networkOnboardingUserJs.marshalOut(result))
}

async function createUser(user, contract, _args, baseOptions) {
  const args = networkOnboardingUserJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createUser',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [networkOnboardingUserJs.contractName],
  }

  const [restStatus, networkOnboardingUserAddress] = await rest.call(user, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  const networkOnboardingUser = await waitNetworkOnboardingUser(user, networkOnboardingUserAddress, options)
  return networkOnboardingUser
}

async function setUserBlockchainAddress(user, contract, args, baseOptions) {
  const {
    username,
    blockchainAddress,
  } = args

  const options = {
    ...baseOptions,
    history: [networkOnboardingUserJs.contractName],
  }
  const callListArgs = []

  if (blockchainAddress !== undefined) {
    const callArgs = {
      contract,
      method: 'setUserBlockchainAddress',
      args: util.usc({
        username,
        blockchainAddress,
      }),
    }
    callListArgs.push(callArgs)
  }

  if (!callListArgs) {
    return contract.get({ blockchainAddress }, options)
  }
  const callListResults = await rest.callList(user, callListArgs, options)

  const networkOnboardingUserAddressArray = callListResults.map((result, index) => {
    const [restStatus, networkOnboardingUserAddress] = result
    if (parseInt(restStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(restStatus, 0, { callArgs: callListArgs[index] })
    }
    return networkOnboardingUserAddress
  })

  return waitNetworkOnboardingUser(user, networkOnboardingUserAddressArray[0], options)
}

async function setUserOrganization(user, contract, args, baseOptions) {
  const {
    username,
    organization,
  } = args

  const options = {
    ...baseOptions,
    history: [networkOnboardingUserJs.contractName],
  }
  const callListArgs = []

  if (organization !== undefined) {
    const callArgs = {
      contract,
      method: 'setUserOrganization',
      args: util.usc({
        username,
        organization,
      }),
    }
    callListArgs.push(callArgs)
  }

  if (!callListArgs) {
    return contract.get({ username }, options)
  }
  
  const callListResults = await rest.callList(user, callListArgs, options)

  const networkOnboardingUserAddressArray = callListResults.map((result, index) => {
    const [restStatus, networkOnboardingUserAddress] = result
    if (parseInt(restStatus, 10) !== RestStatus.OK) {
      throw new rest.RestError(restStatus, 0, { callArgs: callListArgs[index] })
    }
    return networkOnboardingUserAddress
  })

  return waitNetworkOnboardingUser(user, networkOnboardingUserAddressArray[0], options)
}

async function waitNetworkOnboardingUser(user, networkOnboardingUserAddress, options) {
  const contractArgs = {
    name: networkOnboardingUserJs.contractName,
    address: networkOnboardingUserAddress,
  }

  const networkOnboardingUser = await rest.waitForAddress(user, contractArgs, options)
  return networkOnboardingUserJs.marshalOut(networkOnboardingUser)
}

export default {
  uploadContract,
  bind,
  bindAddress,
  get,
  getByOrganization,
  getAll,
}
