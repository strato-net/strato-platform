import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import { getAppRoles } from '/helpers/enums'
import config from '/load.config'

const { createContract } = rest

const contractName = 'AppPermissionManager'
const contractFilename = `${util.cwd}/dapp/permissions/app/contracts/AppPermissionManager.sol`

const grantRole = async (admin, contract, contractArgs, options) => {
  const { user, role } = contractArgs

  const args = {
    id: 'AppChain',
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

const exists = async (admin, contract, methodArgs, options) => {
  const { address } = methodArgs
  const callArgs = {
    contract,
    method: 'exists',
    args: util.usc({ address }),
  }
  const [isUserExist] = await rest.call(admin, callArgs, options)

  if (typeof isUserExist !== 'boolean') {
    throw new rest.RestError(400, 0, { ...callArgs })
  }
  return isUserExist
}


const canCreateUserMembership = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCreateUserMembership'},options)
const canUpdateUserMembership = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canUpdateUserMembership'},options)
const canCreateProduct = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCreateProduct'},options)
const canUpdateProduct = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canUpdateProduct'},options)
const canDeleteProduct = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canDeleteProduct'},options)
const canCreateCategory = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCreateCategory'},options)
const canCreateInventory = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCreateInventory'},options)
const canUpdateInventory = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canUpdateInventory'},options)
const canCreateOrder = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCreateOrder'},options)
const canUpdateOrder = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canUpdateOrder'},options)
const canCreateEvent = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCreateEvent'},options)
const canUpdateEvent = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canUpdateEvent'},options)
const canCertifyEvent = async (admin,contract,args,options) => can(admin,contract,{...args,method:'canCertifyEvent'},options)



const bind = (admin, _contract, options) => {
  const contract = _contract

  contract.grantRole = async (args) => grantRole(admin, contract, args, options)

  contract.grantAdminRole = async (_args) => {
    const role = (getAppRoles()).ADMIN
    const contractArgs = {
      ..._args,
      role,
    }
    await grantRole(admin, contract, contractArgs, options)
  }
  contract.grantTradingEntityRole = async (_args) => {
    const role = (getAppRoles()).TRADINGENTITY
    const contractArgs = {
      ..._args,
      role,
    }
    await grantRole(admin, contract, contractArgs, options)
  }
  contract.grantCertifierRole = async (_args) => {
    const role = (getAppRoles()).CERTIFIER
    const contractArgs = {
      ..._args,
      role,
    }
    await grantRole(admin, contract, contractArgs, options)
  }

  contract.getRolePermissions = async (args) => getRolePermissions(admin, contract, args, options)
  contract.getUserPermissions = async (args) => getUserPermissions(admin, contract, args, options)
  contract.exists = async (args) => exists(admin, contract, args, options)

  contract.canCreateUserMembership =  async (args) => canCreateUserMembership(admin,contract,args,options)
  contract.canUpdateUserMembership = async (args) => canUpdateUserMembership(admin,contract,args,options)
  contract.canCreateProduct = async (args) => canCreateProduct(admin,contract,args,options)
  contract.canUpdateProduct = async (args) => canUpdateProduct(admin,contract,args,options)
  contract.canDeleteProduct = async (args) => canDeleteProduct(admin,contract,args,options)
  contract.canCreateCategory = async (args) => canCreateCategory(admin,contract,args,options)
  contract.canCreateInventory = async (args) => canCreateInventory(admin,contract,args,options)
  contract.canUpdateInventory = async (args) => canUpdateInventory(admin,contract,args,options)
  contract.canCreateOrder = async (args) => canCreateOrder(admin,contract,args,options)
  contract.canUpdateOrder = async (args) => canUpdateOrder(admin,contract,args,options)
  contract.canCreateEvent = async (args) => canCreateEvent(admin,contract,args,options)
  contract.canUpdateEvent = async (args) => canUpdateEvent(admin,contract,args,options)
  contract.canCertifyEvent = async (args) => canCertifyEvent(admin,contract,args,options)

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
