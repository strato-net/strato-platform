/* eslint-disable no-bitwise */
import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import config from '/load.config'
import { setSearchQueryOptions, searchOne, searchAll } from '/helpers/utils'
import applicationJs from './application'

const contractName = 'ApplicationManager'
const contractFilename = `${util.cwd}/${config.dappPath}/application/contracts/ApplicationManager.sol`

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
  contract.getAll = async function (args, options = contractOptions) {
    return getAll(admin, args, options)
  }
  contract.createApplication = async function (args, options = contractOptions) {
    return createApplication(admin, contract, args, options)
  }
  contract.addOrganizationToApplication = async function (args, options = contractOptions) {
    return addOrganizationToApplication(admin, contract, args, options)
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

async function waitApplication(admin, applicationAddress, options) {
  const contractArgs = {
    name: applicationJs.contractName,
    address: applicationAddress,
  }

  // wait for the data to show up in search
  // eslint-disable-next-line no-unused-vars
  const applicationInSearch = await rest.waitForAddress(admin, contractArgs, options)
  return applicationInSearch
}

async function get(admin, args, options) {
  const { applicationName, address, ...restArgs } = args

  if (address) {
    application = await getByAddress(admin, args, options)
  }
  else {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'applicationName', value: applicationName })
    application = await searchOne(applicationJs.contractName, searchArgs, options, admin)
  }
  if (!application) {
    return undefined
  }
  return applicationJs.marshalOut(application)
}

async function getByAddress(admin, args, options) {
  const { address, ...restArgs } = args
  const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address })
  const application = await searchOne(applicationJs.contractName, searchArgs, options, admin)
  if (!organization) {
    return undefined
  }
  return applicationJs.marshalOut(application)
}

async function getByOrganization(admin, args, options) {
  const { organization, ...restArgs } = args
  const searchArgs = setSearchQueryOptions(restArgs, { key: 'ownerOrganization', value: organization })
  const applications = await searchAll(applicationsJs.contractName, searchArgs, options, admin)
  if (!applications) {
    return undefined
  }
  return applications.map((application) => applicationJs.marshalOut(application))
}

async function getAll(admin, args = {}, options) {
  const applications  = await searchAll(applicationJs.contractName, args, options, admin)
  return applications.map((application) => applicationJs.marshalOut(application))
}


async function createApplication(admin, contract, _args, baseOptions) {
  const args = applicationJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createApplication',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [applicationJs.contractName],
  }

  const [restStatus, applicationAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return waitApplication(admin, applicationAddress, options)
}

async function addOrganizationToApplication(admin, contract, _args, baseOptions) {
  const { app, org } = _args

  const callArgs = {
    contract,
    method: 'addOrganizationToApplication',
    args: util.usc({ app, org}),
  }

  const options = {
    ...baseOptions,
    history: [applicationJs.contractName],
  }

  const [restStatus, appAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return waitOrganization(admin, appAddress, options)
}


export default {
  uploadContract,
  bind,
  bindAddress,
  get,
  getByOrganization,
  getAll,
}
