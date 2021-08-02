import { importer, rest, util } from '/blockapps-rest-plus'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import { setSearchQueryOptions, searchOne, searchAll } from '/helpers/utils'

const contractName = 'NetworkOnboardingUsersManager'
const contractFilename = `${util.cwd}/${config.dappPath}/users/contracts/NetworkOnboardingUsersManager.sol`

async function uploadContract(user, args, options) {
  const source = await importer.combine(contractFilename)
  const contractArgs = {
    name: contractName,
    source,
    args: util.usc(args),
  }
  console.log(JSON.stringify(contractArgs));
  const contract = await rest.createContract(user, contractArgs, options)
  contract.src = 'removed'
  return bind(user, contract, options)
}

function bind(user, _contract, contractOptions) {
  const contract = _contract

  contract.getState = async function (options = contractOptions) {
    return rest.getState(user, contract, options)
  }
  contract.registerUser = async function (args, options = contractOptions) {
    return registerUser(user, contract, args, options)
  }
  // contract.updateUserCertificate = async function (args, options = contractOptions) {
  //   return updateUserCertificate(user, contract, args, options)
  // }
  // contract.updateUserRole = async function (args, options = contractOptions) {
  //   return updateUserRole(user, contract, args, options)
  // }
  // contract.getRole = async function (args, options = contractOptions) {
  //   return getRole(user, contract, args, options)
  // }
  return contract
}

function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  }

  return bind(user, contract, options)
}

async function registerUser(user, contract, _args, baseOptions) {

  const callArgs = {
    contract,
    method: 'registerUser',
    args: util.usc(_args),
  }

  const options = {
    ...baseOptions,
  }

  const [restStatus, networkOnboardingUserAddress] = await rest.call(user, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return restStatus
}

export default {
  uploadContract,
  bind,
  bindAddress
}
