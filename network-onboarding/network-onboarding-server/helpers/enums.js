import { util } from '/blockapps-rest-plus'
import { getEnumsCached } from '/helpers/parse'
import config from '/load.config'

// roles
const getRolesInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/permission/contracts/Role.sol`)
const getPermissionsInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/permission/contracts/Permission.sol`)

const getRoles = () => getRolesInternal()
const getPermissions = () => getPermissionsInternal()

export {
  getRoles,
  getPermissions,
}
