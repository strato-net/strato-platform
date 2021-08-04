import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import { getRoles } from '/helpers/enums'
import config from '/load.config'

const { createContract } = rest

const contractName = 'NetworkOnboardingPermissionManager'
const contractFilename = `${util.cwd}/${config.dappPath}/permission/contracts/NetworkOnboardingPermissionManager.sol`

const grantRole = async (admin, contract, contractArgs, options) => {
  const { user, role } = contractArgs

  const args = {
    id: 'NetworkOnboarding',
    address: user.account ? user.account : user.address,
    role,
  }

  const callArgs = {
    contract,
    method: 'grantRole',
    args: util.usc(args),
  }

  const [restStatus, permissions] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { ...callArgs })
  }
  return parseInt(permissions, 10)
}

const can = async (admin, contract, methodArgs, options) => {
  const { method, address } = methodArgs
  const args = { address }

  const callArgs = { contract, method, args: util.usc(args) }
  const [isPermitted] = await rest.call(admin, callArgs, options)
  return isPermitted
}

const getRolePermissions = async (admin, contract, methodArgs, options) => {
  const { role } = methodArgs
  const callArgs = {
    contract,
    method: 'getRolePermissions',
    args: util.usc({ role }),
  }
  const [permissions] = await rest.call(admin, callArgs, options)
  return permissions
}

const getUserPermissions = async (admin, contract, methodArgs, options) => {
  const { address } = methodArgs
  const callArgs = {
    contract,
    method: 'getPermissions',
    args: util.usc({ address }),
  }
  const [restStatus, permissions] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { ...callArgs })
  }
  return permissions
}

const canInviteOrganization = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canInviteOrganization' }, options)
const canCreateOrganization = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canCreateOrganization' }, options)
const canRemoveOrganization = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canRemoveOrganization' }, options)
const canRequestToJoinApplication = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canRequestToJoinApplication' }, options)
const canInviteToJoinApplication = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canInviteToJoinApplication' }, options)
const canCreateApplication = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canCreateApplication' }, options)
const canInviteToJoinOrganization = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canInviteToJoinOrganization' }, options)
const canCreateOrgUser = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canCreateOrgUser' }, options)
const canCreateAnyUser = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canCreateAnyUser' }, options)
const canReadOrgUser = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canReadOrgUser' }, options)
const canReadAnyUser = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canReadAnyUser' }, options)
const canUpdateRoleInNetwork = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canUpdateRoleInNetwork' }, options)
const canUpdateRoleInOrganization = async (admin, contract, args, options) => can(admin, contract, { ...args, method: 'canUpdateRoleInOrganization' }, options)

const bind = (admin, _contract, options) => {
  const contract = _contract

  contract.grantRole = async (args) => grantRole(admin, contract, args, options)

  contract.grantNetworkAdminRole = async (_args) => {
    const role = (getRoles()).NETWORK_ADMIN
    const contractArgs = {
      ..._args,
      role,
    }
    await grantRole(admin, contract, contractArgs, options)
  }
  contract.grantOrganizationAdminRole = async (_args) => {
    const role = (getRoles()).ORG_ADMIN
    const contractArgs = {
      ..._args,
      role,
    }
    await grantRole(admin, contract, contractArgs, options)
  }

  contract.getRolePermissions = async (args) => getRolePermissions(admin, contract, args, options)
  contract.getUserPermissions = async (args) => getUserPermissions(admin, contract, args, options)

  contract.canInviteOrganization = async (args) => canInviteOrganization(admin, contract, args, options)
  contract.canCreateOrganization = async (args) => canCreateOrganization(admin, contract, args, options)
  contract.canRemoveOrganization = async (args) => canRemoveOrganization(admin, contract, args, options)
  contract.canRequestToJoinApplication = async (args) => canRequestToJoinApplication(admin, contract, args, options)
  contract.canInviteToJoinApplication = async (args) => canInviteToJoinApplication(admin, contract, args, options)
  contract.canCreateApplication = async (args) => canCreateApplication(admin, contract, args, options)
  contract.canInviteToJoinOrganization = async (args) => canInviteToJoinOrganization(admin, contract, args, options)
  contract.canCreateOrgUser = async (args) => canCreateOrgUser(admin, contract, args, options)
  contract.canCreateAnyUser = async (args) => canCreateAnyUser(admin, contract, args, options)
  contract.canReadOrgUser = async (args) => canReadOrgUser(admin, contract, args, options)
  contract.canReadAnyUser = async (args) => canReadAnyUser(admin, contract, args, options)
  contract.canUpdateRoleInNetwork = async (args) => canUpdateRoleInNetwork(admin, contract, args, options)
  contract.canUpdateRoleInOrganization = async (args) => canUpdateRoleInOrganization(admin, contract, args, options)
  return contract
}

async function uploadContract(admin, args, options) {
  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(args),
  }

  const contract = await createContract(admin, contractArgs, options)
  contract.src = 'removed'

  return bind(admin, contract, options)
}

const bindAddress = (user, address, options) => {
  const contract = {
    name: contractName,
    address,
  }

  return bind(user, contract, options)
}

export default {
  bind,
  bindAddress,
  uploadContract,
  contractName,
}
