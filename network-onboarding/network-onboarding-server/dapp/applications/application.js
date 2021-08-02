import { importer, rest, util } from '/blockapps-rest-plus'
import config from '/load.config'

const contractName = 'Application'
const contractFilename = `${util.cwd}/${config.dappPath}/applications/contracts/Application.sol`

async function uploadContract(admin, _constructorArgs, baseOptions) {
  const constructorArgs = marshalIn(_constructorArgs)

  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(constructorArgs),
  }

  const options = {
    ...baseOptions,
    history: [contractName],
  }
  const contract = await rest.createContract(admin, contractArgs, options)
  contract.src = 'removed'
  await rest.waitForAddress(admin, contract, baseOptions)
  return bind(admin, contract, options)
}

function marshalIn(_args) {
  const {
    name = '',
    ownerOrganization,
  } = _args
  const args = {
    name,
    ownerOrganization,
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
  const [contractState] = await rest.search(admin, { name: contract.name }, {
    ...options,
    query: {
      address: `eq.${contract.address}`,
    },
  })
  if (contractState) {
    return marshalOut(contractState)
  }
  return {}
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
