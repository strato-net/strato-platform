import { util, rest, importer } from '/blockapps-rest-plus'
import config from '/load.config'

const contractName = 'NetworkOnboardingUser'
const contractFilename = `${util.cwd}/${config.dappPath}/user/contracts/NetworkOnboardingUser.sol`

async function uploadContract(admin, _constructorArgs, options) {
  const constructorArgs = marshalIn(_constructorArgs)
  console.log("HERE2");
  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(constructorArgs),
  }
  const contract = await rest.createContract(admin, contractArgs, options)
  contract.src = 'removed'

  return bind(admin, contract, options)
}

function marshalIn(_args) {
  const args = {
    ..._args,
  }
  return args
}

function marshalOut(_args) {
  const args = {
    ..._args,
  }
  return args
}

async function getState(admin, contract, options) {
  const state = await rest.getState(admin, contract, options)
  return marshalOut(state)
}

function bind(admin, _contract, defaultOptions) {
  const contract = { ..._contract }
  contract.getState = async function (options = defaultOptions) {
    return getState(admin, contract, options)
  }

  return contract
}

function bindAddress(admin, address, options) {
  const contract = {
    name: contractName,
    address,
  }
  return bind(admin, contract, options)
}

export default {
  uploadContract,
  contractName,
  bindAddress,
  marshalIn,
  marshalOut,
}
