import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'

import organizationMembershipJs from './organizationMembership'
import permissionManagerJs from '/dapp/permission/permissionManager'

import { searchAll } from '/helpers/utils'
import { getOrganizationMembershipEvents } from '/helpers/enums'

const { createContract } = rest

const contractName = 'OrganizationMembershipManager'
const contractFilename = `${util.cwd}/dapp/organizationMembership/contracts/OrganizationMembershipManager.sol`

const OrganizationMembershipEvent = getOrganizationMembershipEvents()

const requestOrganizationMembership = async (user, contract, args, options) => {
  const callArgs = {
    contract,
    method: 'requestOrganizationMembership',
    args: util.usc({ ...args }),
  }

  const [restStatus, address] = await rest.call(user, callArgs, options)

  if (
    parseInt(restStatus) !== RestStatus.OK
    && parseInt(restStatus) !== RestStatus.CREATED
  ) {
    throw new rest.RestError(restStatus, 0, { ...callArgs })
  }

  await waitOrganizationMembership(user, address, options)
  return address
}

async function waitOrganizationMembership(admin, organizationMembershipAddress, options) {
  const contractArgs = {
    name: organizationMembershipJs.contractName,
    address: organizationMembershipAddress,
  }

  // wait for the data to show up in search
  // eslint-disable-next-line no-unused-vars
  const state = await rest.waitForAddress(admin, contractArgs, options)
  return state
}

const handleOrganizationMembershipEvent = async (user, contract, args, options) => {
  const callArgs = {
    contract,
    method: 'handleOrganizationMembershipEvent',
    args: util.usc(args),
  }

  const [restStatus, newState] = await rest.call(user, callArgs, options)

  if (parseInt(restStatus) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { ...callArgs })
  }

  return newState
}

const acceptOrganizationMembership = async (user, contract, args, options) => {
  const callArgs = {
    ...args,
    organizationMembershipEvent: OrganizationMembershipEvent.ACCEPT,
  }
  const contractState = await getState(user, contract, options)
  const permissionManager = permissionManagerJs.bindAddress(user, contractState.permissionManager, options)

  const state = await handleOrganizationMembershipEvent(user, contract, callArgs, options)


  return { state }
}

const rejectOrganizationMembership = async (user, contract, args, options) => {
  const callArgs = {
    ...args,
    organizationMembershipEvent: OrganizationMembershipEvent.REJECT,
  }

  return handleOrganizationMembershipEvent(user, contract, callArgs, options)
}

async function getState(admin, contract, options) {
  const [contractState] = await rest.search(
    admin,
    { name: contract.name },
    {
      ...options,
      query: {
        address: `eq.${contract.address}`,
      },
    },
  )
  return contractState
}

const bind = (user, _contract, contractOptions) => {
  const contract = { ..._contract }

  contract.getState = async (options = contractOptions) => getState(user, contract, options)
  contract.requestOrganizationMembership = async (args, options = contractOptions) => requestOrganizationMembership(user, contract, args, options)
  contract.acceptOrganizationMembership = async (args, options = contractOptions) => acceptOrganizationMembership(user, contract, args, options)
  contract.rejectOrganizationMembership = async (args, options = contractOptions) => rejectOrganizationMembership(user, contract, args, options)
  contract.getAll = async (args, options = contractOptions) => getAll(user, args, options)

  return contract
}

const uploadContract = async (admin, args, options) => {
  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(args),
  }

  const { permissionManager } = args

  const contract = await createContract(admin, contractArgs, options)
  contract.src = 'removed'

  await rest.waitForAddress(admin, contract, options)

  contract.permissionManager = permissionManagerJs.bindAddress(
    admin,
    permissionManager,
    options,
  )

  return bind(admin, contract, options)
}

const bindAddress = (user, address, options) => {
  const contract = {
    name: contractName,
    address,
  }

  return bind(user, contract, options)
}

async function getAll(admin, args, options) {
  const results = await searchAll(
    organizationMembershipJs.contractName,
    args,
    options,
    admin,
  )
  const mappedResults = results.map((r) => organizationMembershipJs.marshalOut(r))
  return mappedResults
}

export default {
  bind,
  bindAddress,
  uploadContract,
}
