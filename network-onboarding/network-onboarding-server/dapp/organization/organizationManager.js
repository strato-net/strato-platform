/* eslint-disable no-bitwise */
import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import config from '/load.config'
import { setSearchQueryOptions, searchOne, searchAll } from '/helpers/utils'
import organizationJs from './organization'

const contractName = 'OrganizationManager'
const contractFilename = `${util.cwd}/${config.dappPath}/organization/contracts/OrganizationManager.sol`

async function uploadContract(admin, args, options) {
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

  contract.getState = async function (options = contractOptions) {
    return rest.getState(admin, contract, options)
  }
  contract.get = async function (args, options = contractOptions) {
    return get(admin, args, options)
  }
  contract.getByChainId = async function (args, options = contractOptions) {
    return getByChainId(admin, args, options)
  }
  contract.getAll = async function (args, options = contractOptions) {
    return getAll(admin, args, options)
  }
  contract.createOrganization = async function (args, options = contractOptions) {
    return createOrganization(admin, contract, args, options)
  }
  contract.updateOrganization = async function (args, options = contractOptions) {
    return updateOrganization(admin, contract, args, options)
  }
  contract.setPrivateChainId = async function (args, options = contractOptions) {
    return setPrivateChainId(admin, contract, args, options)
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

async function waitOrganization(admin, organizationAddress, options) {
  const contractArgs = {
    name: organizationJs.contractName,
    address: organizationAddress,
  }

  // wait for the data to show up in search
  // eslint-disable-next-line no-unused-vars
  const organizationInSearch = await rest.waitForAddress(admin, contractArgs, options)
  return organizationInSearch
}

async function get(admin, args, options) {
  const { commonName, address, ...restArgs } = args
  let organization

  if (address) {
    organization = await getByAddress(admin, args, options)
  }
  else {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'commonName', value: commonName })
    organization = await searchOne(organizationJs.contractName, searchArgs, options, admin)
  }
  if (!organization) {
    return undefined
  }
  return organizationJs.marshalOut(organization)
}

async function getByAddress(admin, args, options) {
  const { address, ...restArgs } = args
  const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address })
  const organization = await searchOne(organizationJs.contractName, searchArgs, options, admin)
  if (!organization) {
    return undefined
  }
  return organizationJs.marshalOut(organization)
}

async function getByChainId(admin, args, options) {
  const { chainId, ...restArgs } = args
  const searchArgs = setSearchQueryOptions(restArgs, { key: 'privateChainId', value: chainId })
  const organization = await searchOne(organizationJs.contractName, searchArgs, options, admin)
  if (!organization) {
    return undefined
  }
  return organizationJs.marshalOut(organization)
}

async function getAll(admin, args = {}, options) {
  const organizations = await searchAll(organizationJs.contractName, args, options, admin)
  return organizations.map((organization) => organizationJs.marshalOut(organization))
}

async function createOrganization(admin, contract, _args, baseOptions) {
  const args = organizationJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createOrganization',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [organizationJs.contractName],
  }

  const [restStatus, organizationAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return waitOrganization(admin, organizationAddress, options)
}

async function updateOrganization(admin, contract, _args, baseOptions) {
  const args = organizationJs.marshalIn(_args)

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1
    switch (key) {
      case 'commonName':
        return agg | base
      case 'legalName':
        return agg | (base << 1)
      case 'addressLine1':
        return agg | (base << 2)
      case 'addressLine2':
        return agg | (base << 3)
      case 'addressLine3':
        return agg | (base << 4)
      case 'state':
        return agg | (base << 5)
      case 'country':
        return agg | (base << 6)
      case 'postalCode':
        return agg | (base << 7)
      default:
        return agg
    }
  }, 0)

  const callArgs = {
    contract,
    method: 'updateOrganization',
    args: util.usc({
      scheme,
      ...args,
    }),
  }

  const options = {
    ...baseOptions,
    history: [organizationJs.contractName],
  }

  const [restStatus, organizationAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })

  return waitOrganization(admin, organizationAddress, options)
}

async function setPrivateChainId(admin, contract, args, baseOptions) {
  const callArgs = {
    contract,
    method: 'setPrivateChainId',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [organizationJs.contractName],
  }

  const [restStatus, organizationAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return waitOrganization(admin, organizationAddress, options)
}

export default {
  uploadContract,
  bind,
  bindAddress,
  get,
  getByChainId,
  getAll
}
