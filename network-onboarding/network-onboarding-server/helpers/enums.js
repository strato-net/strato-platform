import { util } from '/blockapps-rest-plus'
import { getEnumsCached } from '/helpers/parse'
import config from '/load.config'

// roles
const getRolesInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/permission/contracts/Role.sol`)
const getPermissionsInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/permission/contracts/Permission.sol`)

const getRoles = () => getRolesInternal()
const getPermissions = () => getPermissionsInternal()

// membership states
const getOrganizationMembershipStatesInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/organization/membership/contracts/OrganizationMembershipState.sol`)
const getOrganizationMembershipEventsInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/organization/membership/contracts/OrganizationMembershipEvent.sol`)
const getOrganizationMembershipStatusesInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/organization/membership/contracts/OrganizationMembershipStatus.sol`)
const getOrganizationMembershipLevelsInternal = getEnumsCached(`${util.cwd}/${config.dappPath}/organization/membership/contracts/OrganizationMembershipLevel.sol`)

const getOrganizationMembershipStates = () => getOrganizationMembershipStatesInternal()
const getOrganizationMembershipEvents = () => getOrganizationMembershipEventsInternal()
const getOrganizationMembershipStatuses = () => getOrganizationMembershipStatusesInternal()
const getOrganizationMembershipLevels = () => getOrganizationMembershipLevelsInternal()

export {
  getRoles,
  getPermissions,
  getOrganizationMembershipStates,
  getOrganizationMembershipEvents,
  getOrganizationMembershipStatuses,
  getOrganizationMembershipLevels
}
