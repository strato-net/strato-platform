import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'

import { getOrganizationMembershipStates } from '/helpers/enums'

const contractName = 'OrganizationMembership'
const contractFilename = `${util.cwd}/dapp/organizationMembership/contracts/OrganizationMembership.sol`

const setState = async (user, contract, args, options) => {
  const callArgs = {
    contract,
    method: 'setState',
    args: util.usc(args),
  }

  const [restStatus] = await rest.call(user, callArgs, options)

  if (parseInt(restStatus) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { ...callArgs })
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

const waitTillProcessed = async (user, contract, options) => {
  const organizationMembershipStates = await getOrganizationMembershipStates()

  const action = async () => rest.getState(user, { name: contractName, address: contract.address }, options)

  const predicate = ({ state }) => state === organizationMembershipStates[organizationMembershipStates.ACCEPTED.toString()] || state === organizationMembershipStates[organizationMembershipStates.REJECTED.toString()]

  const result = await util.until(predicate, action, options, Number.MAX_VALUE)
  return result
}

const bind = (user, _contract, contractOptions) => {
  const contract = { ..._contract }

  contract.getState = async (options = contractOptions) => getState(user, contract, options)
  contract.setState = async (args, options = contractOptions) => setState(user, contract, args, options)
  contract.waitTillProcessed = async (options = contractOptions) => waitTillProcessed(user, contract, options)

  return contract
}

const bindAddress = (user, address, options) => bind(
  user,
  {
    name: contractName,
    address,
  },
  options,
)

async function uploadContract(admin, constructorArgs, options) {
  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(constructorArgs),
  }

  const contract = await rest.createContract(admin, contractArgs, options)
  contract.src = 'removed'

  await rest.waitForAddress(admin, contract, options)
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

export default {
  contractName,
  getState,
  bind,
  bindAddress,
  uploadContract,
  marshalIn,
  marshalOut,
}
